import { z } from 'zod';
import { RecordActivitySchema } from '../schema/record-activity.schema';

export type RecordActivityDto = z.infer<typeof RecordActivitySchema>;
export { RecordActivitySchema };
