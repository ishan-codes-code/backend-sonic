import { IsNotEmpty } from "class-validator";

export class AddSongToPlaylistDto {
    @IsNotEmpty()
    playlistId: string;

    @IsNotEmpty()
    songId: string;
}