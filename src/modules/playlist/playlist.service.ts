import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreatePlaylistDto } from './dto/createPlaylist.dto';
import { DRIZZLE_PROVIDER } from '../../infrastructure/database/database.module';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from '../../infrastructure/database/schema';
import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { AddSongToPlaylistDto } from './dto/addSongToPlaylist.dto';
import { max } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { PlaylistRepository } from './playlist.repository';
import { getTableColumns } from 'drizzle-orm';

@Injectable()
export class PlaylistService {
  constructor(
    @Inject(DRIZZLE_PROVIDER)
    private readonly db: NeonHttpDatabase<typeof schema>,
    private readonly playlistRepository: PlaylistRepository,
  ) { }

  async addPlaylist(userId: string, dto: CreatePlaylistDto) {
    if (dto.name.trim().toLowerCase() === 'favorites') {
      throw new BadRequestException('The name "Favorites" is reserved for the system');
    }

    try {
      const [newPlaylist] = (await this.db
        .insert(schema.playlist)
        .values({
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          userId,
          isPublic: dto.isPublic ?? false,
          isSystem: false, // important → user created playlist
        })
        .returning()) as any;

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
          ...getTableColumns(schema.songs),
          position: schema.playlistSongs.position,
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

  async addSongToPlaylist(userId: string, dto: AddSongToPlaylistDto) {
    const { playlistId, songId } = dto;

    try {
      // 1️⃣ Check playlist ownership
      const playlist = await this.playlistRepository.findByIdAndUserId(
        userId,
        playlistId,
      );

      if (!playlist) {
        throw new NotFoundException('Playlist not found');
      }

      // 2️⃣ Get song info for thumbnail update
      const song = await this.db.query.songs.findFirst({
        where: eq(schema.songs.id, songId),
        columns: { image: true },
      });

      // 3️⃣ Get next position (max + 1)
      const lastSong = await this.db
        .select({
          maxPosition: max(schema.playlistSongs.position),
        })
        .from(schema.playlistSongs)
        .where(eq(schema.playlistSongs.playlistId, playlistId));

      const nextPosition = (lastSong[0]?.maxPosition ?? -1) + 1;

      // 4️⃣ Insert song
      await this.db.insert(schema.playlistSongs).values({
        playlistId,
        songId,
        position: nextPosition,
      });

      // 5️⃣ Update Playlist Thumbnail
      if (song?.image) {
        const currentThumbs = playlist.thumbnailUrl || [];
        if (!currentThumbs.includes(song.image) && currentThumbs.length < 4) {
          await this.db
            .update(schema.playlist)
            .set({ thumbnailUrl: [...currentThumbs, song.image] })
            .where(eq(schema.playlist.id, playlistId));
        }
      }

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

  async removeSongFromPlaylist(userId: string, playlistId: string, songId: string) {
    try {
      const playlist = await this.playlistRepository.findByIdAndUserId(
        userId,
        playlistId,
      );

      if (!playlist) {
        throw new NotFoundException('Playlist not found');
      }

      // 2. Resolve song image
      const song = await this.db.query.songs.findFirst({
        where: eq(schema.songs.id, songId),
        columns: { image: true },
      });

      const result = await this.playlistRepository.removeSongFromPlaylist(playlistId, songId);

      if (!result) {
        throw new NotFoundException('Song not found in playlist');
      }

      // 3. Update Thumbnail if it was present and no other song uses it
      if (song?.image) {
        const currentThumbs = playlist.thumbnailUrl || [];
        if (currentThumbs.includes(song.image)) {
          // Check if any other song in THIS playlist still has the same image
          const otherSongWithSameImage = await this.db
            .select({ id: schema.songs.id })
            .from(schema.playlistSongs)
            .innerJoin(
              schema.songs,
              eq(schema.playlistSongs.songId, schema.songs.id),
            )
            .where(
              and(
                eq(schema.playlistSongs.playlistId, playlistId),
                eq(schema.songs.image, song.image),
              ),
            )
            .limit(1);

          if (otherSongWithSameImage.length === 0) {
            const updatedThumbs = currentThumbs.filter(
              (img) => img !== song.image,
            );
            await this.db
              .update(schema.playlist)
              .set({ thumbnailUrl: updatedThumbs })
              .where(eq(schema.playlist.id, playlistId));
          }
        }
      }

      return {
        message: 'Song removed from playlist',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.log('error:', error);
      throw new InternalServerErrorException('Failed to remove song');
    }
  }
  async deletePlaylist(userId: string, playlistId: string) {
    try {
      const playlist = await this.playlistRepository.findByIdAndUserId(userId, playlistId);
      if (!playlist) {
        throw new NotFoundException('Playlist not found');
      }

      if (playlist.isSystem) {
        throw new BadRequestException('System playlists cannot be deleted');
      }

      const result = (await this.playlistRepository.deletePlaylist(userId, playlistId)) as any;

      if (!result || result.length === 0) {
        throw new NotFoundException('Playlist not found');
      }

      return {
        message: 'Playlist deleted successfully',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.log('error:', error);
      throw new InternalServerErrorException('Failed to delete playlist');
    }
  }

  async createFavoritesPlaylist(userId: string) {
    // 1️⃣ Check if already exists
    const existing = await this.db.query.playlist.findFirst({
      where: and(
        eq(schema.playlist.userId, userId),
        eq(schema.playlist.isSystem, true),
      ),
    });

    if (existing) return existing;

    try {
      // 2️⃣ Create playlist
      const [newPlaylist] = (await this.db
        .insert(schema.playlist)
        .values({
          name: 'Favorites',
          userId,
          isSystem: true,
          isPublic: false,
        })
        .returning()) as any;

      return newPlaylist;
    } catch (err: any) {
      // Handle race condition (duplicate creation)
      // Re-fetch if another request already created it
      const retry = await this.db.query.playlist.findFirst({
        where: and(
          eq(schema.playlist.userId, userId),
          eq(schema.playlist.isSystem, true),
        ),
      });

      if (retry) return retry;

      throw err;
    }
  }
}
