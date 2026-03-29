import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from '../database/schema';
import { DRIZZLE_PROVIDER } from '../database/database.module';

type InsertUser = typeof schema.users.$inferInsert;

@Injectable()
export class UsersService {
  constructor(
    @Inject(DRIZZLE_PROVIDER)
    private readonly db: NeonHttpDatabase<typeof schema>,
  ) {}

  async create(user: InsertUser) {
    const [newUser] = await this.db
      .insert(schema.users)
      .values(user)
      .returning();
    return newUser;
  }

  async findByEmail(email: string) {
    return this.db.query.users.findFirst({
      where: eq(schema.users.email, email),
    });
  }

  async findById(id: string) {
    return this.db.query.users.findFirst({
      where: eq(schema.users.id, id),
    });
  }
}
