import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class RecordPlayDto {
  @IsUUID()
  songId: string;

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
