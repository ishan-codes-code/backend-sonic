import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'PlaySongPayloadShape', async: false })
class PlaySongPayloadShape implements ValidatorConstraintInterface {
  validate(_: unknown, args?: ValidationArguments) {
    const dto = args?.object as PlaySongDto;
    const hasSongId = hasValue(dto.songId);
    const metadataFields = [
      dto.trackName,
      dto.artistName,
      dto.externalId,
      dto.lastfmId,
      dto.duration,
      dto.image,
    ];
    const hasMetadata = metadataFields.some(hasValue);

    if (hasSongId) {
      return !hasMetadata;
    }

    return (
      hasValue(dto.trackName) &&
      hasValue(dto.artistName) &&
      (hasValue(dto.externalId) || hasValue(dto.lastfmId))
    );
  }

  defaultMessage() {
    return 'Provide either { songId } or { trackName, artistName, and at least one of externalId or lastfmId }';
  }
}

export class PlaySongDto {
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsNotEmpty()
  @IsString()
  songId?: string;

  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsNotEmpty()
  @IsString()
  trackName?: string;

  @IsOptional()
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

  @IsOptional()
  @IsNumber()
  duration?: number;

  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsNotEmpty()
  @IsString()
  image?: string;

  @Validate(PlaySongPayloadShape)
  private readonly payloadShape?: never;
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}


export class WorkerCallbackDto {
  @IsString()
  @IsNotEmpty()
  youtubeId!: string;

  @IsEnum(['completed', 'failed'])
  status!: 'completed' | 'failed';

  @IsOptional()
  @IsString()
  error?: string;
}