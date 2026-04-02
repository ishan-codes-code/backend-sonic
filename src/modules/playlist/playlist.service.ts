import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreatePlaylistDto } from './dto/createPlaylist.dto';
import { DRIZZLE_PROVIDER } from 'src/infrastructure/database/database.module';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from '../../infrastructure/database/schema';
import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { SongToPlaylistDto } from './dto/addSongToPlaylisy.dto';
import { max } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { PlaylistRepository } from './playlist.repository';

@Injectable()
export class PlaylistService {
  constructor(
    @Inject(DRIZZLE_PROVIDER)
    private readonly db: NeonHttpDatabase<typeof schema>,
    private readonly playlistRepository: PlaylistRepository,
  ) { }

  async addPlaylist(userId: string, dto: CreatePlaylistDto) {
    try {
      const [newPlaylist] = await this.db
        .insert(schema.playlist)
        .values({
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          userId,
          isPublic: dto.isPublic ?? false,
          isSystem: false, // important → user created playlist
        })
        .returning();

      return {
        message: 'Playlist created successfully',
        data: newPlaylist,
      };
    } catch (error) {
      // 🔥 Handle unique constraint (very important)
      const code = error?.code || error?.cause?.code;
      if (code === '23505') {
        throw new ConflictException(
          'You already have a playlist with this name',
        );
      }
      console.log('error: ', error);
      throw new InternalServerErrorException('Failed to create playlist');
    }
  }

  async getUserPlaylists(userId: string) {
    try {
      const playlists = await this.db
        .select({
          id: schema.playlist.id,
          name: schema.playlist.name,
          description: schema.playlist.description,
          isPublic: schema.playlist.isPublic,
          createdAt: schema.playlist.createdAt,
          thumbnailUrl: schema.playlist.thumbnailUrl,
          songCount: sql<number>`count(${schema.playlistSongs.id})`,
        })
        .from(schema.playlist)
        .leftJoin(
          schema.playlistSongs,
          eq(schema.playlist.id, schema.playlistSongs.playlistId)
        )
        .where(eq(schema.playlist.userId, userId))
        .groupBy(schema.playlist.id)
        .orderBy(desc(schema.playlist.createdAt));

      return playlists;
    } catch (error) {
      console.log('error: ', error);
      throw new InternalServerErrorException('Failed to get playlists');
    }
  }

  async getPlaylistSongs(userId: string, playlistId: string) {
    try {
      // 1️⃣ Get playlist
      const playlist = await this.db.query.playlist.findFirst({
        where: and(
          eq(schema.playlist.id, playlistId),
          eq(schema.playlist.userId, userId),
        ),
      });

      if (!playlist) {
        throw new NotFoundException('Playlist not found');
      }

      // 2️⃣ Get songs using join
      const songs = await this.db
        .select({
          id: schema.songs.id,
          title: schema.songs.title,
          duration: schema.songs.duration,
          youtubeId: schema.songs.youtubeId,
          position: schema.playlistSongs.position,
          channelName: schema.songs.channelName,
          channelId: schema.songs.channelId,
        })
        .from(schema.playlistSongs)
        .innerJoin(
          schema.songs,
          eq(schema.playlistSongs.songId, schema.songs.id),
        )
        .where(eq(schema.playlistSongs.playlistId, playlistId))
        .orderBy(asc(schema.playlistSongs.position));

      return songs;
    } catch (error) {
      console.log('error:', error);
      throw new InternalServerErrorException('Failed to get playlist');
    }
  }

  async addSongToPlaylist(userId: string, dto: SongToPlaylistDto) {
    const { playlistId, songId } = dto;

    try {
      // 1️⃣ Check playlist ownership
      const playlist = await this.playlistRepository.returnPlaylistId(
        userId,
        playlistId,
      );

      if (!playlist) {
        throw new NotFoundException('Playlist not found');
      }

      // 2️⃣ Get next position (max + 1)
      const lastSong = await this.db
        .select({
          maxPosition: max(schema.playlistSongs.position),
        })
        .from(schema.playlistSongs)
        .where(eq(schema.playlistSongs.playlistId, playlistId));

      const nextPosition = (lastSong[0]?.maxPosition ?? -1) + 1;

      // 3️⃣ Insert song
      await this.db.insert(schema.playlistSongs).values({
        playlistId,
        songId,
        position: nextPosition,
      });

      return {
        message: 'Song added to playlist',
      };
    } catch (error: any) {
      console.log('error:', error);

      // 🔥 Handle duplicate (unique constraint)
      if (error.code === '23505') {
        throw new ConflictException('Song already exists in playlist');
      }

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to add song');
    }
  }

  async removeSongFromPlaylist(userId: string, dto: SongToPlaylistDto) {
    try {
      const { playlistId, songId } = dto;

      const playlist = await this.playlistRepository.returnPlaylistId(
        userId,
        playlistId,
      );

      if (!playlist) {
        throw new NotFoundException('Playlist not found');
      }

      // 2️⃣ Get the song position (IMPORTANT)
      const songEntry = await this.db.query.playlistSongs.findFirst({
        where: and(
          eq(schema.playlistSongs.playlistId, playlistId),
          eq(schema.playlistSongs.songId, songId),
        ),
        columns: { position: true },
      });

      if (!songEntry) {
        throw new NotFoundException('Song not found in playlist');
      }

      const deletedPosition = songEntry.position;

      // 3️⃣ Delete the song
      await this.db
        .delete(schema.playlistSongs)
        .where(
          and(
            eq(schema.playlistSongs.playlistId, playlistId),
            eq(schema.playlistSongs.songId, songId),
            eq(schema.playlistSongs.position, deletedPosition),
          ),
        );

      // 4️⃣ Shift remaining songs (IMPORTANT 🔥)
      await this.db
        .update(schema.playlistSongs)
        .set({
          position: sql`${schema.playlistSongs.position} - 1`,
        })
        .where(
          and(
            eq(schema.playlistSongs.playlistId, playlistId),
            gt(schema.playlistSongs.position, deletedPosition),
          ),
        );

      return {
        message: 'Song removed from playlist',
      };
    } catch (error) {
      console.log('error:', error);

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to remove song');
    }
  }
}
