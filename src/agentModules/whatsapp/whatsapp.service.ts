import { Injectable, OnModuleInit, Logger, NotFoundException } from '@nestjs/common';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
  initAuthCreds,
  AuthenticationCreds,
  SignalKeyStore,
} from '@whiskeysockets/baileys';
import { toDataURL } from 'qrcode';
import { Boom } from '@hapi/boom';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import pino from 'pino';
import * as qrcode from 'qrcode-terminal';
import { MessageHandlerService } from './handlers/message-handler.service';

// ... (BufferJSON and WhatsappConnection interface remain the same)
const BufferJSON = {
  replacer: (key, value) => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === 'Buffer') {
      return {
        type: 'Buffer',
        data: Buffer.from(value?.data || value).toString('base64'),
      };
    }
    return value;
  },
  reviver: (key, value) => {
    if (typeof value === 'object' && value !== null && value.type === 'Buffer') {
      return Buffer.from(value.data, 'base64');
    }
    return value;
  },
};

interface WhatsappConnection {
  socket: WASocket | null;
  qr?: string;
  status: 'connecting' | 'open' | 'close' | 'error';
}


@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly baileysLogger = pino({ level: 'silent' });
  private connections = new Map<string, WhatsappConnection>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageHandler: MessageHandlerService,
  ) {}

  async onModuleInit() {
    this.logger.log('Checking for existing WhatsApp sessions in the database to reconnect...');
    const activeAgents = await this.prisma.agent.findMany({
        where: { isActive: true }
    });
    
    for (const agent of activeAgents) {
        const session = await this.prisma.whatsapp.findUnique({ where: { agentId: agent.id } });
        if (session && session.sessionData) {
            this.logger.log(`Found active session for agent ${agent.id}. Attempting to reconnect...`);
            this.start(agent.id).catch(err => {
                this.logger.error(`Failed to auto-reconnect agent ${agent.id}: ${err.message}`);
            });
        }
    }
  }

  async sendText(agentId: string, jid: string, text: string): Promise<{ id: string }> {
  const conn = (this as any).connections?.get(agentId);
  const sock = conn?.socket;
  if (!sock) throw new NotFoundException('WhatsApp is not connected for this agent');

  const res = await sock.sendMessage(jid, { text });
  // Baileys returns an object with key/id; normalize to { id }
  const id = (res as any)?.key?.id ?? '';
  return { id };
}

  async start(agentId: string): Promise<{ qr?: string; status: string; message: string }> {
    const existingConnection = this.connections.get(agentId);
    if (existingConnection && existingConnection.status !== 'close') {
        this.logger.warn(`Connection for agent ${agentId} is already active or connecting.`);
        return { 
            qr: existingConnection.qr, 
            status: existingConnection.status, 
            message: 'Connection process is already underway.' 
        };
    }

    this.logger.log(`Starting WhatsApp connection for agent: ${agentId}`);
    this.connections.set(agentId, { socket: null, status: 'connecting' });

    return new Promise(async (resolve, reject) => {
        let promiseHandled = false;

        try {
            const whatsappRecord = await this.prisma.whatsapp.findUnique({ where: { agentId } });

            let creds: AuthenticationCreds;
            let keys: Record<string, any> = {};

            if (whatsappRecord && whatsappRecord.sessionData && typeof whatsappRecord.sessionData === 'string') {
                const sessionData = JSON.parse(whatsappRecord.sessionData, BufferJSON.reviver);
                creds = sessionData.creds;
                keys = sessionData.keys;
            } else {
                creds = initAuthCreds();
            }

            const saveState = async () => {
                const sessionToSave = { creds, keys };
                const sessionString = JSON.stringify(sessionToSave, BufferJSON.replacer);
                await this.prisma.whatsapp.upsert({
                    where: { agentId },
                    create: { agentId, sessionData: sessionString },
                    update: { sessionData: sessionString },
                });
            };
            
            const signalStore: SignalKeyStore = {
                get: (type, ids) => Promise.resolve(ids.reduce((acc: { [id: string]: any }, id) => {
                    const value = keys[`${type}-${id}`];
                    if (value) acc[id] = value;
                    return acc;
                }, {})),
                set: (data) => {
                    for (const type in data) {
                        const typeData = data[type as keyof typeof data];
                        if (typeData) {
                            for (const id in typeData) {
                                keys[`${type}-${id}`] = typeData[id];
                            }
                        }
                    }
                    return Promise.resolve();
                },
            };

            const { version } = await fetchLatestBaileysVersion();
            const socket = makeWASocket({
                version,
                printQRInTerminal: false,
                auth: { creds, keys: makeCacheableSignalKeyStore(signalStore, this.baileysLogger) },
                logger: this.baileysLogger,
            });
            
            const connection = this.connections.get(agentId);
            if (connection) {
                connection.socket = socket;
            } else {
                const error = new Error('Connection could not be established in map.');
                socket.end(error);
                if (!promiseHandled) { promiseHandled = true; return reject(error); }
                return;
            }

            socket.ev.on('creds.update', saveState);

            socket.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;
                const conn = this.connections.get(agentId);
                if (!conn) return;

                if (qr) {
                    this.logger.log(`QR code for agent ${agentId} received.`);
                    qrcode.generate(qr, { small: true });
                    const qrDataURL = await toDataURL(qr);
                    conn.qr = qrDataURL;
                    conn.status = 'connecting';
                    if (!promiseHandled) {
                        promiseHandled = true;
                        resolve({ qr: qrDataURL, status: 'connecting', message: 'QR code received. Please scan.' });
                    }
                }

                if (connection === 'close') {
                    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                    const reason = DisconnectReason[statusCode] || 'Unknown';
                    this.logger.error(`Connection closed for agent ${agentId}. Reason: ${reason}`);
                    conn.status = 'close';
                    conn.qr = undefined;

                    if (!promiseHandled) {
                        promiseHandled = true;
                        reject(new Error(`Connection closed. Reason: ${reason}`));
                    }

                    if (statusCode !== DisconnectReason.loggedOut) {
                        setTimeout(() => this.start(agentId), 5000);
                    } else {
                        await this.prisma.whatsapp.update({
                            where: { agentId },
                            data: { sessionData: Prisma.JsonNull, whatsappJid: null, whatsappName: null },
                        });
                        this.connections.delete(agentId);
                    }
                } else if (connection === 'open') {
                    this.logger.log(`Connection opened successfully for agent ${agentId}`);
                    conn.status = 'open';
                    conn.qr = undefined;

                    // --- NEW: Auto-activate agent on successful login ---
                    if (socket.user) {
                        await this.prisma.agent.update({
                            where: { id: agentId },
                            data: { isActive: true },
                        });
                        await this.prisma.whatsapp.update({
                            where: { agentId },
                            data: { whatsappJid: socket.user.id, whatsappName: socket.user.name },
                        });
                        this.logger.log(`Agent ${agentId} has been automatically activated.`);
                    }
                    // --- End of new logic ---

                    if (!promiseHandled) {
                        promiseHandled = true;
                        resolve({ status: 'open', message: 'Connection successful.' });
                    }
                }
            });

            socket.ev.on('messages.upsert', async ({ messages }) => {
                this.messageHandler.handleMessage(socket, messages[0], agentId);
            });

        } catch (error) {
            this.logger.error(`Failed to start connection for agent ${agentId}: ${error.message}`);
            if (!promiseHandled) {
                promiseHandled = true;
                reject(error);
            }
        }
    });
  }

  getStatus(agentId: string): string {
    return this.connections.get(agentId)?.status || 'disconnected';
  }

  async logout(agentId: string) {
    const conn = this.connections.get(agentId);
    if (conn?.socket) {
      this.logger.log(`Logging out agent ${agentId}...`);
      await conn.socket.logout();
    }
  }

  // --- NEW: Method to toggle agent status ---
  async toggleAgentStatus(agentId: string, isActive: boolean) {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      throw new NotFoundException(`Agent with ID ${agentId} not found.`);
    }

    // If turning off, close the WhatsApp connection
    if (!isActive) {
        const connection = this.connections.get(agentId);
        if (connection?.socket) {
            this.logger.log(`Agent ${agentId} deactivated. Closing WhatsApp connection.`);
            // Use logout to clear session properly
            await connection.socket.logout();
        }
    }
    
    return this.prisma.agent.update({
      where: { id: agentId },
      data: { isActive },
    });
  }
}




