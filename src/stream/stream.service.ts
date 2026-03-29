import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { R2Service } from 'src/r2/r2.service';
import { SongsService } from 'src/songs/songs.service';

@Injectable()
export class StreamService {
    constructor(
        private readonly songsService: SongsService,
        private readonly r2Service: R2Service
    ) { }

    async getUrl(userId: string, songId: string) {
        const isOwner = await this.songsService.isUserOwnsSong(userId, songId);
        if (!isOwner) {
            throw new HttpException('You do not have this song in your library', HttpStatus.FORBIDDEN);
        }

        const song = await this.songsService.findById(songId);
        if (!song) {
            throw new HttpException('Song not found in global storage', HttpStatus.NOT_FOUND);
        }

        const streamUrl = await this.r2Service.getSignedUrl(song.r2Key);
        return { streamUrl };
    }
}



