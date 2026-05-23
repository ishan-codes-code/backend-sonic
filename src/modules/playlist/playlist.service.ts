import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreatePlaylistDto, UpdatePlaylistDto } from './dto/createPlaylist.dto';
import { DRIZZLE_PROVIDER } from '../../infrastructure/database/database.module';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from '../../infrastructure/database/schema';
import { and, asc, desc, eq, gt, or } from 'drizzle-orm';
import { AddSongToPlaylistDto } from './dto/addSongToPlaylist.dto';
import { max } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { PlaylistRepository } from './playlist.repository';
import { getTableColumns } from 'drizzle-orm';
import { toSongDto } from '../song/dto/play-response.dto';
import { PlaybackSessionService } from '../playback-session/playback-session.service';

const MAX_PLAYLIST_CACHE_SIZE = 1000; // Strictly bound cache to 1000 active playlists in memory

@Injectable()
export class PlaylistService {
  private readonly playlistCache = new Map<string, any>();

  constructor(
    @Inject(DRIZZLE_PROVIDER)
    private readonly db: NeonHttpDatabase<typeof schema>,
    private readonly playlistRepository: PlaylistRepository,
    private readonly playbackSessionService: PlaybackSessionService,
  ) {}

  async addPlaylist(userId: string, dto: CreatePlaylistDto) {
    if (dto.name.trim().toLowerCase() === 'favorites') {
      throw new BadRequestException(
        'The name "Favorites" is reserved for the system',
      );
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
    } catch (error: any) {
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
          isSystem: schema.playlist.isSystem,
          createdAt: schema.playlist.createdAt,
          thumbnailUrl: schema.playlist.thumbnailUrl,
          songCount: sql<number>`count(${schema.playlistSongs.id})`,
        })
        .from(schema.playlist)
        .leftJoin(
          schema.playlistSongs,
          eq(schema.playlist.id, schema.playlistSongs.playlistId),
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

  async getPlaylistById(userId: string, playlistId: string) {
    try {
      const playlist = await this.db
        .select({
          id: schema.playlist.id,
          name: schema.playlist.name,
          description: schema.playlist.description,
          isPublic: schema.playlist.isPublic,
          isSystem: schema.playlist.isSystem,
          createdAt: schema.playlist.createdAt,
          updatedAt: schema.playlist.updatedAt,
          thumbnailUrl: schema.playlist.thumbnailUrl,
          songCount: sql<number>`count(${schema.playlistSongs.id})`,
        })
        .from(schema.playlist)
        .leftJoin(
          schema.playlistSongs,
          eq(schema.playlist.id, schema.playlistSongs.playlistId),
        )
        .where(
          and(
            eq(schema.playlist.id, playlistId),
            or(
              eq(schema.playlist.userId, userId),
              and(
                eq(schema.playlist.isPublic, true),
                eq(schema.playlist.isSystem, false),
              ),
            ),
          ),
        )
        .groupBy(schema.playlist.id)
        .limit(1);

      if (!playlist || playlist.length === 0) {
        throw new NotFoundException('Playlist not found');
      }

      return playlist[0];
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.log('error: ', error);
      throw new InternalServerErrorException('Failed to get playlist');
    }
  }

  async getPlaylistWithSongs(
    userId: string,
    playlistId: string,
    deviceId: string,
  ) {
    try {
      const cached = this.playlistCache.get(playlistId);

      let playlistData: any;

      if (
        cached &&
        (cached.user.id === userId || (cached.isPublic && !cached.isSystem))
      ) {
        // LRU Update: Delete and re-insert to move it to the end of the insertion order (most recently used)
        this.playlistCache.delete(playlistId);
        this.playlistCache.set(playlistId, cached);
        playlistData = cached;
      } else {
        const playlist = await this.db.query.playlist.findFirst({
          where: and(
            eq(schema.playlist.id, playlistId),
            or(
              eq(schema.playlist.userId, userId),
              and(
                eq(schema.playlist.isPublic, true),
                eq(schema.playlist.isSystem, false),
              ),
            ),
          ),
          with: {
            user: true,
            songs: {
              with: {
                song: {
                  with: {
                    artists: {
                      with: {
                        artist: true,
                      },
                      orderBy: [asc(schema.songArtists.position)],
                    },
                  },
                },
              },
              orderBy: [asc(schema.playlistSongs.position)],
            },
          },
        });

        if (!playlist) {
          throw new NotFoundException('Playlist not found');
        }

        playlistData = {
          id: playlist.id,
          name: playlist.name,
          description: playlist.description,
          isPublic: playlist.isPublic,
          isSystem: playlist.isSystem,
          thumbnailUrl: playlist.thumbnailUrl,
          createdAt: playlist.createdAt,
          updatedAt: playlist.updatedAt,
          user: {
            id: playlist.user.id,
            name: playlist.user.name,
            email: playlist.user.email,
          },
          tracks: playlist.songs.map((ps) => {
            const song = ps.song as any;
            const songWithArtists = {
              ...song,
              artists: song.artists?.map((sa: any) => sa.artist) || [],
            };
            return {
              ...toSongDto(songWithArtists),
              position: ps.position,
            };
          }),
        };

        // Bounded Cache Protection: Evict the least recently used item (the oldest insertion entry)
        if (this.playlistCache.size >= MAX_PLAYLIST_CACHE_SIZE) {
          const oldestKey = this.playlistCache.keys().next().value;
          if (oldestKey !== undefined) {
            this.playlistCache.delete(oldestKey);
          }
        }

        this.playlistCache.set(playlistId, playlistData);
      }

      const playbackToken =
        await this.playbackSessionService.getOrCreatePlaybackToken(
          userId,
          deviceId,
        );

      return {
        ...playlistData,
        playbackToken,
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      const code = error?.cause?.code || error?.code;

      switch (code) {
        case '22P02':
          throw new BadRequestException('Invalid playlist id');
        default:
          console.log('error:', error);
          throw new InternalServerErrorException('Failed to get playlist');
      }
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

      this.playlistCache.delete(playlistId);

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

  async removeSongFromPlaylist(
    userId: string,
    playlistId: string,
    songId: string,
  ) {
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

      const result = await this.playlistRepository.removeSongFromPlaylist(
        playlistId,
        songId,
      );

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

      this.playlistCache.delete(playlistId);

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
      const playlist = await this.playlistRepository.findByIdAndUserId(
        userId,
        playlistId,
      );
      if (!playlist) {
        throw new NotFoundException('Playlist not found');
      }

      if (playlist.isSystem) {
        throw new BadRequestException('System playlists cannot be deleted');
      }

      const result = (await this.playlistRepository.deletePlaylist(
        userId,
        playlistId,
      )) as any;

      if (!result || result.length === 0) {
        throw new NotFoundException('Playlist not found');
      }

      this.playlistCache.delete(playlistId);

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
          description: 'Your favorite tracks, all in one place.',
          userId,
          isSystem: false,
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

  async findUserPlaylistIdsBySong(userId: string, songId: string) {
    try {
      const playlists = await this.db
        .select({
          id: schema.playlist.id,
        })
        .from(schema.playlistSongs)
        .innerJoin(
          schema.playlist,
          eq(schema.playlistSongs.playlistId, schema.playlist.id),
        )
        .where(
          and(
            // song exists
            eq(schema.playlistSongs.songId, songId),

            // belongs to user
            eq(schema.playlist.userId, userId),

            // exclude system playlists
            eq(schema.playlist.isSystem, false),
          ),
        );

      return playlists.map((playlist) => playlist.id);
    } catch (error: any) {
      // already normalized
      if (error instanceof HttpException) {
        throw error;
      }

      // invalid uuid / malformed input
      if (error?.code === '22P02') {
        throw new BadRequestException('Invalid request data');
      }

      // known db constraint violations
      if (
        error?.code === '23503' ||
        error?.code === '23505' ||
        error?.code === '23514'
      ) {
        throw new BadRequestException('Invalid request');
      }

      // internal logging only
      console.error('findPlaylistsContainingSong error:', {
        message: error?.message,
        code: error?.code,
      });

      // safe generic response
      throw new InternalServerErrorException('Something went wrong');
    }
  }

  async updatePlaylist(
    userId: string,
    playListId: string,
    dto: UpdatePlaylistDto,
  ) {
    let updatedPlaylist;

    try {
      updatedPlaylist = await this.db
        .update(schema.playlist)
        .set({
          ...(dto.name !== undefined && {
            name: dto.name,
          }),

          ...(dto.description !== undefined && {
            description: dto.description,
          }),

          ...(dto.isPublic !== undefined && {
            isPublic: dto.isPublic,
          }),
        })
        .where(
          and(
            eq(schema.playlist.id, playListId),
            eq(schema.playlist.userId, userId),
            eq(schema.playlist.isSystem, false),
          ),
        )
        .returning();
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      const code = error?.cause?.code || error?.code;

      switch (code) {
        case '22P02':
          throw new BadRequestException('Invalid playlist id');

        case '23505':
          throw new ConflictException('Playlist already exists');

        case '23503':
          throw new BadRequestException('Referenced resource does not exist');

        default:
          throw new InternalServerErrorException('Failed to update playlist');
      }
    }

    if (updatedPlaylist.length === 0) {
      throw new NotFoundException('Playlist not found');
    }

    this.playlistCache.delete(playListId);

    return updatedPlaylist[0];
  }
}
