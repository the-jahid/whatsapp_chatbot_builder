// src/lead-item/lead-item.controller.ts

import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { LeadItemService, GetAllLeadItemsQuery } from './lead-item.service';
import { CreateLeadItemDto, UpdateLeadItemDto } from './dto/lead-item.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ZodValidationPipe } from 'src/common/pipes/zod.validation.pipe';
import { createLeadItemSchema, updateLeadItemSchema } from './schema/lead-item.schema';

@ApiTags('Lead Items')
@Controller('lead-items')
export class LeadItemController {
  constructor(private readonly leadItemService: LeadItemService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new lead item (product/service)' })
  @ApiResponse({ status: 201, description: 'The lead item has been successfully created.' })
  @ApiResponse({ status: 404, description: 'The specified agent was not found.' })
  @ApiResponse({ status: 409, description: 'A lead item with this name already exists for the agent.' })
  create(@Body(new ZodValidationPipe(createLeadItemSchema)) createLeadItemDto: CreateLeadItemDto) {
    return this.leadItemService.create(createLeadItemDto);
  }

  @Get('agent/:agentId')
  @ApiOperation({ summary: 'Get all lead items for a specific agent' })
  @ApiParam({ name: 'agentId', description: 'The UUID of the agent' })
  @ApiQuery({ name: 'name', type: String, required: false, description: 'Filter by lead item name (case-insensitive search).' })
  @ApiQuery({ name: 'description', type: String, required: false, description: 'Filter by lead item description (case-insensitive search).' })
  @ApiQuery({ name: 'page', type: Number, required: false, description: 'Page number for pagination.' })
  @ApiQuery({ name: 'limit', type: Number, required: false, description: 'Number of items per page.' })
  @ApiResponse({ status: 200, description: 'A paginated list of lead items for the agent.' })
  findAllForAgent(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Query() query: GetAllLeadItemsQuery,
  ) {
    return this.leadItemService.findAllForAgent(agentId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific lead item by its ID' })
  @ApiParam({ name: 'id', description: 'The UUID of the lead item' })
  @ApiResponse({ status: 200, description: 'The lead item record.' })
  @ApiResponse({ status: 404, description: 'Lead item not found.' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.leadItemService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a lead item' })
  @ApiParam({ name: 'id', description: 'The UUID of the lead item' })
  @ApiResponse({ status: 200, description: 'The lead item has been successfully updated.' })
  @ApiResponse({ status: 404, description: 'Lead item not found.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateLeadItemSchema)) updateLeadItemDto: UpdateLeadItemDto,
  ) {
    return this.leadItemService.update(id, updateLeadItemDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a lead item' })
  @ApiParam({ name: 'id', description: 'The UUID of the lead item' })
  @ApiResponse({ status: 204, description: 'The lead item has been successfully deleted.' })
  @ApiResponse({ status: 404, description: 'Lead item not found.' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.leadItemService.remove(id);
  }
}
