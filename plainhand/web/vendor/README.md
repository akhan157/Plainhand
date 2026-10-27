# Vendored front-end dependencies

Plainhand's browser app has no build step and loads no code from a CDN. The page
CSP is `script-src 'self'`, so every module the page imports lives in this folder
and is served by `plainhand-server.mjs` like any other file under `plainhand/web/`.

## `preact-htm.mjs`

| | |
| --- | --- |
| Package | [`htm`](https://github.com/developit/htm) |
| Exact version | 3.1.1 (`npm pack htm@3.1.1`) |
| npm integrity | `sha512-983Vyg8NwUE7JkZ6NmOqpCZ+sh1bKv2iYTlUkzlWmA5JD2acKoxd4KVxbMmxX/85mtfdnDmTFoNKcg5DGAvxNQ==` |
| Source file in the package | `preact/standalone.module.js` (copied unmodified) |
| SHA-256 of `preact-htm.mjs` | `72284e8e9079c87817145df1110f74e8a2aa040b2fc384922e18dfcb46fc1fd7` |
| Contents | htm bound to Preact, with Preact 10 and its hooks bundled in one ES module |
| Exports | `h`, `html`, `render`, `Component`, `createContext`, `useState`, `useReducer`, `useEffect`, `useLayoutEffect`, `useRef`, `useImperativeHandle`, `useMemo`, `useCallback`, `useContext`, `useDebugValue`, `useErrorBoundary` |
| Imports | None. The file has no `import` statements, so no import map is needed. |

### Licences

- **htm** is licensed under the Apache License 2.0. The full text is in
  [`LICENSE-htm.txt`](LICENSE-htm.txt), copied from the package.
- **Preact**, bundled inside the same file by htm's own build, is licensed under
  the MIT License:

  > The MIT License (MIT)
  >
  > Copyright (c) 2015-present Jason Miller
  >
  > Permission is hereby granted, free of charge, to any person obtaining a copy
  > of this software and associated documentation files (the "Software"), to deal
  > in the Software without restriction, including without limitation the rights
  > to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  > copies of the Software, and to permit persons to whom the Software is
  > furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice shall be included in
  > all copies or substantial portions of the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  > IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  > FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  > AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  > LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  > OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
  > THE SOFTWARE.

### Updating

1. In an empty scratch folder: `npm pack htm@<version>` and extract the tarball.
2. Check that `package/preact/standalone.module.js` still has no `import`
   specifiers (`grep -c "import" file` should print 0).
3. Copy it over `preact-htm.mjs`, update the version, integrity and SHA-256 above,
   and run `xvfb-run -a npm run test:plainhand-ui`.
