'use client';

import { type Components, defaultRehypePlugins, Streamdown } from 'streamdown';

/**
 * Elements rendered markdown may not contain: images could load arbitrary URLs (data
 * exfiltration). Links go through Streamdown's confirmation dialog.
 */
export const DISALLOWED_ELEMENTS = ['img'];

/**
 * Streamdown's rehype plugins without `raw`, so raw HTML in the text is not rendered. The
 * sanitizer and the link/image hardening still run.
 */
const { raw: _raw, ...safeRehypePlugins } = defaultRehypePlugins;
export const SAFE_REHYPE_PLUGINS = Object.values(safeRehypePlugins);

/** Headings sized for a chat answer or a passage in a side panel. */
export const HEADING_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h3 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h3>
  ),
  h3: ({ children }) => <h4 className="mt-3 mb-1.5 font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 className="mt-3 mb-1.5 font-semibold first:mt-0">{children}</h5>,
  h5: ({ children }) => <h6 className="mt-3 mb-1.5 font-semibold first:mt-0">{children}</h6>,
  h6: ({ children }) => <h6 className="mt-3 mb-1.5 font-semibold first:mt-0">{children}</h6>,
};

/** Static (non-streaming) markdown, e.g. a source passage, with the same hardening as answers. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <Streamdown
      mode="static"
      className={className}
      rehypePlugins={SAFE_REHYPE_PLUGINS}
      components={HEADING_COMPONENTS}
      disallowedElements={DISALLOWED_ELEMENTS}
    >
      {text}
    </Streamdown>
  );
}
