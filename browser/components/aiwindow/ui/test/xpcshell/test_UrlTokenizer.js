/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

const { UrlTokenizer } = ChromeUtils.importESModule(
  "moz-src:///browser/components/aiwindow/ui/modules/UrlTokenizer.sys.mjs"
);

add_task(async function test_UrlTokenizer_encodeToken() {
  const cases = [
    {
      message: "Works for a URL with a path.",
      url: "http://www.github.com/foo/bar/baz",
      expected: "GITHUB_COM_FOO_BAR_BAZ_1",
    },
    {
      message:
        "Returns a new number for a URL that is different but creates the same token.",
      url: "http://www.github.com/foo/bar/baz?ignored",
      expected: "GITHUB_COM_FOO_BAR_BAZ_2",
    },
    {
      message: "Returns the exact same token given another URL",
      url: "http://www.github.com/foo/bar/baz",
      expected: "GITHUB_COM_FOO_BAR_BAZ_1",
    },
    {
      message:
        "Returns a different token given the same URL with a different protocol",
      url: "https://www.github.com/foo/bar/baz",
      expected: "GITHUB_COM_FOO_BAR_BAZ_3",
    },
    {
      message: "Can handle about URLs.",
      url: "about:config",
      expected: "ABOUT_CONFIG_1",
    },
    {
      message: "Uses non-http protocols",
      url: "ftp://github.com/foo/bar/baz",
      expected: "FTP_GITHUB_COM_FOO_BAR_BAZ_1",
    },
    {
      message: "Uses invalid protocols",
      url: "asdf://github.com/foo/bar/baz",
      expected: "ASDF_GITHUB_COM_FOO_BAR_BAZ_1",
    },
    {
      message: "Ignores the port.",
      url: "http://github.com:1234/ignore/port",
      expected: "GITHUB_COM_IGNORE_PORT_1",
    },
    {
      message: "Ignores the params.",
      url: "http://www.github.com/ignore/params?token=xxx",
      expected: "GITHUB_COM_IGNORE_PARAMS_1",
    },
    {
      message: "Ignores the hash.",
      url: "http://www.github.com/ignore/hash/part?token=xxx#hash",
      expected: "GITHUB_COM_IGNORE_HASH_PART_1",
    },
    {
      message: "Truncates text in the host from 110 to 100.",
      url: `http://www.${"a".repeat(110)}.com/foo`,
      expected: "A".repeat(100) + "_1",
    },
    {
      message: "Skips text in the path that is too long",
      url: `http://github.com/skip/long/path/` + "A".repeat(100),
      expected: "GITHUB_COM_SKIP_LONG_PATH_1",
    },
  ];

  const urlTokenizer = new UrlTokenizer({});

  for (const { message, url, expected } of cases) {
    const token = urlTokenizer.encodeToken(url);
    Assert.equal(token, expected, message);

    const decodedUrl = urlTokenizer.tokenToUrl.get(token);
    Assert.equal(
      decodedUrl,
      url,
      `Expected the decoded token (${token}) to equal '${url}' but got: ${decodedUrl}`
    );
  }
});
