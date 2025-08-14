import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaClientExceptionFilter } from './common/filters/prisma-client-exception.filter';


async function bootstrap() {
  const app = await NestFactory.create(AppModule);
    app.enableCors({
    origin: 'http://localhost:3001', // The origin of your Next.js app
       methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
  
  // This line registers the filter globally.
  // It ensures that every Prisma error will be processed by your filter.
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new PrismaClientExceptionFilter());


  await app.listen(3000);
}
bootstrap();