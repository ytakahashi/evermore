import type { Api } from '../shared/api-types';

declare global {
  interface Window {
    api: Api;
  }
}
