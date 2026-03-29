import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class SongDto {
    @IsNotEmpty()
    @IsString()
    youtubeId: string;

    @IsOptional()
    @IsString()
    title: string;

    @IsOptional()
    @IsNumber()
    duration: number
}

export class PlaySongDto {
    @IsNotEmpty()
    songId: string;
}
