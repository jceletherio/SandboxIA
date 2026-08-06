import { PartialType } from '@nestjs/mapped-types';
import { CreateCliProfileDto } from './create-cli-profile.dto';

export class UpdateCliProfileDto extends PartialType(CreateCliProfileDto) {}
