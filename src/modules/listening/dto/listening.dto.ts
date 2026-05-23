import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RecordPlayDto {
  @IsUUID()
  @IsOptional()
  id?: string;

  @ValidateIf((dto: RecordPlayDto) => !dto.id)
  @IsUUID()
  songId?: string;

  @IsInt()
  @IsOptional()
  @Min(0)
  durationListenedSeconds?: number;

  @IsBoolean()
  @IsOptional()
  completed?: boolean;

}

export class GetHistoryQueryDto {
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number = 20;

  @IsInt()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  offset?: number = 0;
}

export class ProgressSyncDto {
  @IsUUID()
  mediaId: string;

  @IsNumber()
  @Min(0)
  position: number;

  @IsNumber()
  duration: number;

  @IsNumber()
  timestamp: number;
}
