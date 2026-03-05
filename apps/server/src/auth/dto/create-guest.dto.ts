import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateGuestDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  nickname?: string;
}
