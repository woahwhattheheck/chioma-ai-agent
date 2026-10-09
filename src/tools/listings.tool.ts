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


/**
 * Compare a bounded shortlist without making mutations or inferring facts
 * that are absent from the published listing and matching responses.
 */
@Injectable()
export class CompareShortlistedPropertiesTool implements AgentTool {
  definition = {
    name: 'compare_shortlisted_properties',
    description:
      'Compare 2–8 shortlisted published properties side by side: price, location, rooms, amenities and personal match reasons. Use property IDs from Chioma, not guessed listings.',
    parameters: {
      type: 'object',
      properties: {
        propertyIds: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 8,
          uniqueItems: true,
          description: 'Two to eight distinct published property IDs to compare.',
        },
      },
      required: ['propertyIds'],
    },
  };

  constructor(private readonly chiomaApi: ChiomaApiClient) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const rawIds = args.propertyIds;
    if (!Array.isArray(rawIds) || rawIds.length < 2 || rawIds.length > 8 ||
      rawIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new Error('Provide 2–8 non-empty property IDs for comparison');
    }
    const propertyIds: string[] = (rawIds as string[]).map((id) => id.trim());
    if (new Set(propertyIds.map((id) => id.toLowerCase())).size !== propertyIds.length) {
      throw new Error('Shortlisted property IDs must be distinct');
    }

    // One property at a time caps outstanding backend reads at two, avoiding
    // an unbounded request burst while still grouping each listing and score.
    const properties = [];
    for (const propertyId of propertyIds) {
      const [listing, match] = await Promise.all([
        this.chiomaApi.getProperty(context.accessToken, propertyId),
        this.chiomaApi.getMatchScore(context.accessToken, propertyId),
      ]);
      if (listing.id.toLowerCase() !== propertyId.toLowerCase() ||
        match.propertyId.toLowerCase() !== propertyId.toLowerCase()) {
        throw new Error('Backend property comparison response does not match requested ID');
      }
      properties.push({
        propertyId,
        title: listing.title,
        propertyType: listing.type,
        price: listing.price,
        currency: listing.currency,
        location: {
          address: listing.address ?? null,
          city: listing.city ?? null,
          state: listing.state ?? null,
          country: listing.country ?? null,
        },
        bedrooms: listing.bedrooms ?? null,
        bathrooms: listing.bathrooms ?? null,
        area: listing.area ?? null,
        isFurnished: listing.isFurnished ?? null,
        hasParking: listing.hasParking ?? null,
        petsAllowed: listing.petsAllowed ?? null,
        verificationStatus: listing.verificationStatus ?? null,
        matchScore: match.score,
        matchReasons: match.reasons,
      });
    }
    return JSON.stringify({ comparedCount: properties.length, properties });
  }
}
