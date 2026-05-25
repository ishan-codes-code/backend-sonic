import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class RecommendationQueryDto {
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number = 20;
}
