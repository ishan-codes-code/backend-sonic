import {
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    ValidateIf,
} from 'class-validator';

export class PlaySongDto {
    // ✅ CASE 1: Direct song
    @ValidateIf((o: PlaySongDto) => !o.trackName && !o.artistName)
    @IsNotEmpty()
    @IsString()
    songId?: string;

    // ✅ CASE 2: Search-based
    @ValidateIf((o: PlaySongDto) => !o.songId)
    @IsNotEmpty()
    @IsString()
    trackName?: string;

    @ValidateIf((o: PlaySongDto) => !o.songId)
    @IsNotEmpty()
    @IsString()
    artistName?: string;

    // ✅ Optional enhancement
    @IsOptional()
    @IsNumber()
    duration?: number;
}


