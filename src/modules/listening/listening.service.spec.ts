import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ListeningService } from './listening.service';

describe('ListeningService', () => {
  it('updates a specific listening event without inserting a duplicate', async () => {
    const updatedEvent = {
      id: 'event-1',
      userId: 'user-1',
      songId: 'song-1',
      durationListenedSeconds: 214,
      completed: true,
      isManualAdd: true,
    };
    const db = createDbMock({ updatedEvents: [updatedEvent] });
    const service = new ListeningService(db as any);

    await expect(
      service.recordPlay('user-1', {
        id: 'event-1',
        durationListenedSeconds: 214,
        completed: true,
      }),
    ).resolves.toEqual(updatedEvent);

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.query.listeningEvents.findFirst).not.toHaveBeenCalled();
  });

  it('throws when updating an event that does not belong to the user', async () => {
    const db = createDbMock({ updatedEvents: [] });
    const service = new ListeningService(db as any);

    await expect(
      service.recordPlay('user-1', {
        id: 'missing-event',
        completed: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires a song id when creating a new listening event', async () => {
    const db = createDbMock();
    const service = new ListeningService(db as any);

    await expect(service.recordPlay('user-1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

function createDbMock({
  updatedEvents = [],
  insertedEvents = [],
  lastEvent = null,
}: {
  updatedEvents?: unknown[];
  insertedEvents?: unknown[];
  lastEvent?: unknown;
} = {}) {
  const updateReturning = jest.fn().mockResolvedValue(updatedEvents);
  const updateWhere = jest.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = jest.fn().mockReturnValue({ where: updateWhere });

  const insertReturning = jest.fn().mockResolvedValue(insertedEvents);
  const insertValues = jest
    .fn()
    .mockReturnValue({ returning: insertReturning });

  return {
    query: {
      listeningEvents: {
        findFirst: jest.fn().mockResolvedValue(lastEvent),
      },
    },
    update: jest.fn().mockReturnValue({ set: updateSet }),
    insert: jest.fn().mockReturnValue({ values: insertValues }),
  };
}
