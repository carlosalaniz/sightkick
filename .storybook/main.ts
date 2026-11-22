import type { StorybookConfig } from '@storybook/react-vite';
import tailwindcss from '@tailwindcss/vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  core: {
    disableTelemetry: true,
  },
  viteFinal: async (conf) => {
    conf.plugins = [tailwindcss(), ...(conf.plugins ?? [])];
    conf.define = { ...conf.define, __SK_WEB__: 'false' };

    return conf;
  },
};

export default config;
