import { IsNotEmpty } from "class-validator";

export class SongToPlaylistDto {
    @IsNotEmpty()
    playlistId: string;

    @IsNotEmpty()
    songId: string;
}