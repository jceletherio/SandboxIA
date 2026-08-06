import { PartialType } from '@nestjs/mapped-types';
import { CreateMacroTaskDto } from './create-macro-task.dto';

export class UpdateMacroTaskDto extends PartialType(CreateMacroTaskDto) {}
