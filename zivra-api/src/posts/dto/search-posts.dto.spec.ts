import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchPostsDto } from './search-posts.dto';

describe('SearchPostsDto', () => {
  test('rejects q > 50 chars', async () => {
    const dto = plainToInstance(SearchPostsDto, { q: 'a'.repeat(51) });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  test('rejects limit 999', async () => {
    const dto = plainToInstance(SearchPostsDto, { q: 'hi', limit: 999 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  test('accepts valid q and limit', async () => {
    const dto = plainToInstance(SearchPostsDto, { q: 'blue', limit: 12 });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  test('rejects invalid cursor uuid', async () => {
    const dto = plainToInstance(SearchPostsDto, { cursor: 'bad-uuid' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  test('trims q', async () => {
    const dto = plainToInstance(SearchPostsDto, { q: '  hello  ' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.q).toBe('hello');
  });
});
