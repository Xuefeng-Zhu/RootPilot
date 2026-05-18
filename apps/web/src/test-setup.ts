import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useParams: vi.fn(() => ({})),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  })),
  usePathname: vi.fn(() => '/'),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

// Mock next/link - returns a simple anchor element
// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mock('next/link', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: ({ children, href, ...props }: any) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const React = require('react');
    return React.createElement('a', { href, ...props }, children);
  },
}));
