import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  ValidateIf,
  Validate,
} from 'class-validator';
import { IsExternalOrLastfm } from '../../../infrastructure/common/validators/is-external-or-lastfm.validator';
import { Transform } from 'class-transformer';

export class PlaySongDto {
  // ✅ CASE 1: Direct play
  @IsOptional()
  @IsString()
  songId?: string;

  @ValidateIf((o: PlaySongDto) => !o.songId)
  @Transform(({ value }) => value?.trim())
  @IsNotEmpty()
  @IsString()
  trackName?: string;

  @ValidateIf((o: PlaySongDto) => !o.songId)
  @Transform(({ value }) => value?.trim())
  @IsNotEmpty()
  @IsString()
  artistName?: string;

  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsNotEmpty()
  @IsString()
  externalId?: string;

  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsNotEmpty()
  @IsString()
  lastfmId?: string;

  @Validate(IsExternalOrLastfm)
  validationTrigger!: boolean;

  @IsOptional()
  @IsNumber()
  duration?: number;

  @IsOptional()
  @ValidateIf((o: PlaySongDto) => !o.songId)
  @Transform(({ value }) => value?.trim())
  @IsNotEmpty()
  @IsString()
  image?: string;
}
