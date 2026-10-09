import {
  GetMatchScoreTool,
  GetRecommendationsTool,
  GetSimilarPropertiesTool,
  CompareShortlistedPropertiesTool,
} from './listings.tool';
import { ChiomaApiClient } from '../integrations/chioma-api/chioma-api.client';

describe('listings tools', () => {
  const context = { accessToken: 'tok' };

  function makeClient() {
    const getRecommendations = jest.fn<
      ReturnType<ChiomaApiClient['getRecommendations']>,
      Parameters<ChiomaApiClient['getRecommendations']>
    >();
    const getProperty = jest.fn<
      ReturnType<ChiomaApiClient['getProperty']>,
      Parameters<ChiomaApiClient['getProperty']>
    >();
    const getMatchScore = jest.fn<
      ReturnType<ChiomaApiClient['getMatchScore']>,
      Parameters<ChiomaApiClient['getMatchScore']>
    >();
    const getSimilarProperties = jest.fn<
      ReturnType<ChiomaApiClient['getSimilarProperties']>,
      Parameters<ChiomaApiClient['getSimilarProperties']>
    >();
    const client = {
      getRecommendations,
      getProperty,
      getMatchScore,
      getSimilarProperties,
    } as unknown as ChiomaApiClient;
    return { client, getRecommendations, getProperty, getMatchScore, getSimilarProperties };
  }

  it('GetRecommendationsTool forwards the access token and default limit', async () => {
    const { client, getRecommendations } = makeClient();
    getRecommendations.mockResolvedValue([{ propertyId: 'p1', score: 0.9, reasons: [] }]);
    const tool = new GetRecommendationsTool(client);

    const result = await tool.execute({}, context);

    expect(getRecommendations).toHaveBeenCalledWith('tok', 10);
    expect(JSON.parse(result)).toEqual([{ propertyId: 'p1', score: 0.9, reasons: [] }]);
  });

  it('GetRecommendationsTool honors an explicit limit', async () => {
    const { client, getRecommendations } = makeClient();
    getRecommendations.mockResolvedValue([]);
    const tool = new GetRecommendationsTool(client);

    await tool.execute({ limit: 3 }, context);

    expect(getRecommendations).toHaveBeenCalledWith('tok', 3);
  });

  it('GetMatchScoreTool passes through the propertyId', async () => {
    const { client, getMatchScore } = makeClient();
    getMatchScore.mockResolvedValue({ propertyId: 'p1', score: 0.5, reasons: [] });
    const tool = new GetMatchScoreTool(client);

    const result = await tool.execute({ propertyId: 'p1' }, context);

    expect(getMatchScore).toHaveBeenCalledWith('tok', 'p1');
    expect(JSON.parse(result)).toEqual({ propertyId: 'p1', score: 0.5, reasons: [] });
  });

  it('GetSimilarPropertiesTool uses the default limit when not provided', async () => {
    const { client, getSimilarProperties } = makeClient();
    getSimilarProperties.mockResolvedValue([]);
    const tool = new GetSimilarPropertiesTool(client);

    await tool.execute({ propertyId: 'p1' }, context);

    expect(getSimilarProperties).toHaveBeenCalledWith('tok', 'p1', 5);
  });

  it('CompareShortlistedPropertiesTool returns ordered public listings and match reasons', async () => {
    const { client, getProperty, getMatchScore } = makeClient();
    const one = '123e4567-e89b-42d3-a456-426614174000';
    const two = '123e4567-e89b-42d3-a456-426614174001';
    getProperty
      .mockResolvedValueOnce({
        id: one, title: 'First home', type: 'apartment', price: '1200.00',
        currency: 'USD', city: 'Louisville', bedrooms: 2, isFurnished: true,
      })
      .mockResolvedValueOnce({
        id: two, title: 'Second home', type: 'house', price: '1400.00',
        currency: 'USD', city: 'Louisville', bedrooms: 3,
      });
    getMatchScore
      .mockResolvedValueOnce({ propertyId: one, score: 0.92, reasons: ['near_transit'] })
      .mockResolvedValueOnce({ propertyId: two, score: 0.84, reasons: ['more_space'] });

    const tool = new CompareShortlistedPropertiesTool(client);
    const comparison = JSON.parse(
      await tool.execute({ propertyIds: [one, two] }, context),
    );

    expect(comparison.comparedCount).toBe(2);
    expect(comparison.properties.map((item: { propertyId: string }) => item.propertyId))
      .toEqual([one, two]);
    expect(comparison.properties[0]).toMatchObject({
      title: 'First home', price: '1200.00', currency: 'USD',
      location: { city: 'Louisville' }, bedrooms: 2,
      matchScore: 0.92, matchReasons: ['near_transit'],
    });
    expect(comparison.properties[1]).toMatchObject({
      title: 'Second home', matchScore: 0.84, matchReasons: ['more_space'],
    });
    expect(getProperty).toHaveBeenNthCalledWith(1, 'tok', one);
    expect(getProperty).toHaveBeenNthCalledWith(2, 'tok', two);
    expect(getMatchScore).toHaveBeenNthCalledWith(1, 'tok', one);
    expect(getMatchScore).toHaveBeenNthCalledWith(2, 'tok', two);
  });

  it('CompareShortlistedPropertiesTool rejects invalid/duplicate IDs without backend calls', async () => {
    const { client, getProperty, getMatchScore } = makeClient();
    const tool = new CompareShortlistedPropertiesTool(client);
    await expect(tool.execute({ propertyIds: ['p1'] }, context))
      .rejects.toThrow('2–8');
    await expect(tool.execute({ propertyIds: ['p1', ' P1 '] }, context))
      .rejects.toThrow('distinct');
    await expect(tool.execute({ propertyIds: ['p1', ''] }, context))
      .rejects.toThrow('non-empty');
    expect(getProperty).not.toHaveBeenCalled();
    expect(getMatchScore).not.toHaveBeenCalled();
  });

  it('CompareShortlistedPropertiesTool refuses mismatched backend property IDs', async () => {
    const { client, getProperty, getMatchScore } = makeClient();
    getProperty.mockResolvedValue({
      id: 'different', title: 'Incorrect record', type: 'house', price: 100,
      currency: 'USD',
    });
    getMatchScore.mockResolvedValue({
      propertyId: 'requested', score: 0.5, reasons: [],
    });
    const tool = new CompareShortlistedPropertiesTool(client);
    await expect(tool.execute({ propertyIds: ['requested', 'other'] }, context))
      .rejects.toThrow('does not match requested ID');
  });
});
