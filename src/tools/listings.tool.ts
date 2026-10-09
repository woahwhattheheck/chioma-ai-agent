import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { ChiomaApiClient } from '../integrations/chioma-api/chioma-api.client';

@Injectable()
export class GetRecommendationsTool implements AgentTool {
  definition = {
    name: 'get_property_recommendations',
    description:
      'Get personalized property listing recommendations for the current user, ranked by match score.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of recommendations to return.',
          default: 10,
        },
      },
    },
  };

  constructor(private readonly chiomaApi: ChiomaApiClient) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const recommendations = await this.chiomaApi.getRecommendations(
      context.accessToken,
      (args.limit as number) ?? 10,
    );
    return JSON.stringify(recommendations);
  }
}

@Injectable()
export class GetMatchScoreTool implements AgentTool {
  definition = {
    name: 'get_property_match_score',
    description:
      "Get the current user's match score and reasons for a specific property listing.",
    parameters: {
      type: 'object',
      properties: {
        propertyId: { type: 'string', description: 'The property listing ID.' },
      },
      required: ['propertyId'],
    },
  };

  constructor(private readonly chiomaApi: ChiomaApiClient) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const score = await this.chiomaApi.getMatchScore(
      context.accessToken,
      args.propertyId as string,
    );
    return JSON.stringify(score);
  }
}

/**
 * Compare shortlisted properties using only the authenticated matching API.
 * The comparison intentionally contains no unverified rent, address or inventory data.
 */
@Injectable()
export class CompareShortlistedPropertiesTool implements AgentTool {
  definition = {
    name: 'compare_shortlisted_properties',
    description:
      'Compare 2 to 8 shortlisted property listings side by side using the current user\'s matching scores and reasons.',
    parameters: {
      type: 'object',
      properties: {
        propertyIds: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 8,
          uniqueItems: true,
          description: 'Two to eight distinct property listing IDs to compare, in display order.',
        },
      },
      required: ['propertyIds'],
    },
  };

  constructor(private readonly chiomaApi: ChiomaApiClient) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const ids = args.propertyIds;
    if (
      !Array.isArray(ids) ||
      ids.length < 2 ||
      ids.length > 8 ||
      ids.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) ||
      new Set(ids).size !== ids.length
    ) {
      throw new Error('propertyIds must contain 2 to 8 distinct, valid listing IDs');
    }

    const comparisons = await Promise.all(
      ids.map(async (propertyId: string) => {
        const result = await this.chiomaApi.getMatchScore(context.accessToken, propertyId);
        if (
          result.propertyId !== propertyId ||
          !Number.isFinite(result.score) ||
          !Array.isArray(result.reasons) ||
          !result.reasons.every((reason) => typeof reason === 'string')
        ) {
          throw new Error('Backend returned an invalid property match-score response');
        }
        return {
          propertyId,
          matchScore: result.score,
          reasons: result.reasons,
        };
      }),
    );

    return JSON.stringify({ propertyIds: ids, comparisons });
  }
}

@Injectable()
export class GetSimilarPropertiesTool implements AgentTool {
  definition = {
    name: 'get_similar_properties',
    description: 'Get properties similar to a given property listing.',
    parameters: {
      type: 'object',
      properties: {
        propertyId: { type: 'string', description: 'The property listing ID.' },
        limit: {
          type: 'number',
          description: 'Maximum number of similar properties to return.',
          default: 5,
        },
      },
      required: ['propertyId'],
    },
  };

  constructor(private readonly chiomaApi: ChiomaApiClient) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const similar = await this.chiomaApi.getSimilarProperties(
      context.accessToken,
      args.propertyId as string,
      (args.limit as number) ?? 5,
    );
    return JSON.stringify(similar);
  }
}
