import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from '../database/schema';
import { DRIZZLE_PROVIDER } from '../database/database.module';

type InsertSession = typeof schema.sessions.$inferInsert;

@Injectable()
export class SessionsService {
  constructor(
    @Inject(DRIZZLE_PROVIDER)
    private readonly db: NeonHttpDatabase<typeof schema>,
  ) {}

  async create(session: InsertSession) {
    const [newSession] = await this.db
      .insert(schema.sessions)
      .values(session)
      .returning();
    return newSession;
  }

  async findById(id: string) {
    return this.db.query.sessions.findFirst({
      where: eq(schema.sessions.id, id),
    });
  }

  async delete(id: string) {
    await this.db.delete(schema.sessions).where(eq(schema.sessions.id, id));
  }

  async deleteAllForUser(userId: string) {
    await this.db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  }
}
