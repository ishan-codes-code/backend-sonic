import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { songs, userLibrary } from '../database/schema';
import { DRIZZLE_PROVIDER } from '../database/database.module';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from '../database/schema';
import { SongDto } from './dto/song.dto';
import { SongFilesService } from 'src/song-files/song-files.service';
import { randomUUID } from 'crypto';
import { R2Service } from 'src/r2/r2.service';

@Injectable()
export class SongsService {
    constructor(
        @Inject(DRIZZLE_PROVIDER) private readonly db: NeonHttpDatabase<typeof schema>,
        private readonly songFilesService: SongFilesService,
        private readonly r2Service: R2Service,

    ) { }

    async findByYoutubeId(youtubeId: string) {
        const results = await this.db.select().from(songs).where(eq(songs.youtubeId, youtubeId)).limit(1);
        return results[0] || null;
    }

    async findById(id: string) {
        const results = await this.db.select().from(songs).where(eq(songs.id, id)).limit(1);
        return results[0] || null;
    }

    async createSong(data: {
        id: string;
        youtubeId: string;
        title: string;
        duration: number;
        r2Key: string;
    }) {
        const [newSong] = await this.db.insert(songs).values({
            id: data.id,
            youtubeId: data.youtubeId,
            title: data.title,
            duration: data.duration,
            r2Key: data.r2Key,
        }).returning();
        return newSong;
    }

    async deleteSong(id: string) {
        await this.db.delete(songs).where(eq(songs.id, id));
    }

    async addToUserLibrary(userId: string, songId: string) {
        // ignore if already exists
        try {
            await this.db.insert(userLibrary).values({
                userId,
                songId,
            }).onConflictDoNothing();
        } catch (err) {
            console.warn('Conflict adding to user library, likely already there.');
        }
    }

    async isUserOwnsSong(userId: string, songId: string) {
        const results = await this.db
            .select()
            .from(userLibrary)
            .where(and(eq(userLibrary.userId, userId), eq(userLibrary.songId, songId)))
            .limit(1);
        return results.length > 0;
    }

    async getUserLibrary(userId: string) {
        // join with songs table
        const results = await this.db
            .select({
                songId: songs.id,
                title: songs.title,
                duration: songs.duration,
                youtubeId: songs.youtubeId,
            })
            .from(userLibrary)
            .innerJoin(songs, eq(userLibrary.songId, songs.id))
            .where(eq(userLibrary.userId, userId));
        return results;
    }

    async getAllSongs() {
        return await this.db.select({
            songId: songs.id,
            title: songs.title,
            duration: songs.duration,
            youtubeId: songs.youtubeId,
        }).from(songs);
    }

    async play(songDto: SongDto) {
        const { youtubeId, title, duration } = songDto;

        let song = await this.findByYoutubeId(youtubeId);

        if (song) {
            console.log('Song already exists');
            const streamUrl = await this.r2Service.getSignedUrl(song.r2Key);
            console.log('Sent url');
            return { streamUrl };
        }

        if (!title || !duration) {
            console.log('Fetching song metadata');
            throw new BadRequestException('Title and duration are required');
        }

        console.log('Downloading and uploading');
        const result = await this.songFilesService.downloadAudio(youtubeId);

        const r2Key = result.r2Key;
        const songId = randomUUID();

        try {
            song = await this.createSong({
                id: songId,
                ...songDto,
                r2Key,
            })
        } catch (err: any) {
            // If it's a unique constraint violation, try to fetch the song that was just created
            if (err.message?.includes('duplicate key value')) {
                song = await this.findByYoutubeId(youtubeId);
            } else {
                throw err;
            }
        }

        if (!song) {
            throw new Error('Failed to create or retrieve song after upload.');
        }

        const streamUrl = await this.r2Service.getSignedUrl(song.r2Key);
        console.log('Sent url');
        return { streamUrl };
    }




}
