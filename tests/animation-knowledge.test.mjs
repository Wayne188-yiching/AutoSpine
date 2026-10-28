import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { request as httpRequest } from "node:http";
import { youTubeVideoId } from "../tools/animation-library-view.mjs";
import {
  canonicalizeSourceUrl,
  validateCatalog,
  searchEntries,
  renderIndex,
  createLibraryServer,
} from "../tools/animation-knowledge.mjs";

const catalog = JSON.parse(
  await readFile(new URL("../knowledge/animation/catalog.json", import.meta.url), "utf8"),
);
const clone = (value) => JSON.parse(JSON.stringify(value));
const copy = () => clone(catalog);

test("current catalogue is valid and covers US, Europe and Japan", () => {
  assert.deepEqual(validateCatalog(catalog), []);
  for (const region of ["us", "europe", "japan"])
    assert.ok(
      catalog.entries.some(
        (entry) => entry.region === region && entry.review.status !== "metadata-only",
      ),
    );
});
test("deduplicates YouTube spellings while keeping meaningful website parameters", () => {
  for (const url of [
    "https://youtu.be/oijlB8CvHR8?t=12",
    "https://m.youtube.com/watch?v=oijlB8CvHR8&feature=share",
    "https://www.youtube.com/embed/oijlB8CvHR8",
    "https://www.youtube.com/shorts/oijlB8CvHR8",
  ])
    assert.equal(canonicalizeSourceUrl(url), "https://www.youtube.com/watch?v=oijlB8CvHR8");
  assert.equal(
    canonicalizeSourceUrl("https://example.com/lesson?page=3&utm_source=test#pose"),
    "https://example.com/lesson?page=3",
  );
  assert.throws(() => canonicalizeSourceUrl("javascript:alert(1)"));
  assert.throws(() => canonicalizeSourceUrl("https://secret@example.com/"));
});
test("rejects duplicate videos across independent entries", () => {
  const data = copy(),
    duplicate = clone(data.entries[0]);
  duplicate.id = "duplicate-video";
  duplicate.source.url = "https://youtu.be/oijlB8CvHR8?t=10";
  data.entries.push(duplicate);
  assert.ok(validateCatalog(data).some((error) => error.includes("duplicate source")));
});
test("metadata and isolated stills cannot claim reviewed motion timing", () => {
  const data = copy(),
    entry = data.entries.find((item) => item.review.status === "metadata-only");
  entry.observations.push("Unwatched motion claim");
  assert.ok(validateCatalog(data).some((error) => error.includes("metadata-only cannot claim")));
  const sampled = data.entries.find((item) => item.review.status === "visual-samples");
  sampled.review.timingBasis = "continuous-video";
  assert.ok(validateCatalog(data).some((error) => error.includes("sampled stills")));
});
test("continuous review requires a valid interval within the source", () => {
  const data = copy(),
    entry = data.entries[0];
  entry.review.status = "clip-reviewed";
  entry.review.timingBasis = "continuous-video";
  assert.ok(validateCatalog(data).some((error) => error.includes("watched intervals")));
  entry.review.segments = [{ start: 5, end: 10, note: "Test interval" }];
  assert.deepEqual(validateCatalog(data), []);
  entry.review.segments[0].end = entry.source.durationSeconds + 1;
  assert.ok(validateCatalog(data).some((error) => error.includes("invalid watched segment")));
});
test("rejects unknown classifications and malformed notes", () => {
  const data = copy();
  data.entries[0].techniques = ["invented"];
  data.entries[0].limits = [];
  data.entries[0].review.samples[0].seconds = -1;
  assert.ok(validateCatalog(data).some((error) => error.includes("invalid techniques")));
  assert.ok(validateCatalog(data).some((error) => error.includes("limits required")));
  assert.ok(validateCatalog(data).some((error) => error.includes("invalid sampled frame")));
  assert.ok(validateCatalog(null).length > 0);
});
test("search retrieves labels in Chinese and leaves metadata in the queue by default", () => {
  assert.ok(searchEntries(catalog, "剪影").some((entry) => entry.id === "us-wdfm-silhouette"));
  assert.ok(searchEntries(catalog, "japan layout").every((entry) => entry.region === "japan"));
  assert.ok(!searchEntries(catalog).some((entry) => entry.review.status === "metadata-only"));
  assert.equal(searchEntries(catalog, "", true).length, catalog.entries.length);
  const sampleOnly = copy();
  sampleOnly.entries = [
    sampleOnly.entries.find((entry) => entry.id === "us-wb-superrabbit-acting"),
  ];
  assert.equal(
    searchEntries(sampleOnly, "timing").length,
    0,
    "JSON field names are not technique evidence",
  );
});
test("offline HTML escapes untrusted notes and refuses invalid source protocols", () => {
  const data = copy();
  data.entries[0].observations.push('<img src=x onerror="alert(1)">');
  const html = renderIndex(data);
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.ok(!html.includes('<img src=x onerror="alert(1)">'));
  assert.ok(html.includes('data-region="europe"'));
  assert.ok(!html.includes("<iframe"));
  data.entries[0].source.url = "javascript:alert(1)";
  assert.throws(() => renderIndex(data));
});

test("video previews accept only recognized YouTube video identities", () => {
  assert.equal(youTubeVideoId("https://youtu.be/oijlB8CvHR8?t=5"), "oijlB8CvHR8");
  assert.equal(youTubeVideoId("https://www.youtube.com/watch?v=PKHQuQF1S8k"), "PKHQuQF1S8k");
  assert.equal(youTubeVideoId("https://example.com/watch?v=PKHQuQF1S8k"), null);
  assert.equal(youTubeVideoId("https://www.youtube.com/watch?v=bad%22%3E"), null);
  assert.equal(youTubeVideoId("http://www.youtube.com/watch?v=PKHQuQF1S8k"), null);
  const html = renderIndex(catalog);
  assert.ok(html.includes('data-video="oijlB8CvHR8"'));
  assert.ok(html.includes('href="https://www.youtube.com/watch?v=oijlB8CvHR8&amp;t=5s"'));
  assert.ok(html.includes("https://i.ytimg.com/vi/oijlB8CvHR8/hqdefault.jpg"));
  assert.ok(html.includes("--base-60:#08131b"));
  assert.ok(html.includes("--accent-10:#ff9a5c"));
});

test("the local viewer serves only the library and cannot expose project files", async () => {
  const server = createLibraryServer();
  await new Promise((ready, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", ready);
  });
  const port = server.address().port;
  const get = (path, method = "GET") =>
    new Promise((resolve, reject) => {
      const request = httpRequest(
        { hostname: "127.0.0.1", port, path, method, agent: false },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () =>
            resolve({ status: response.statusCode, headers: response.headers, body }),
          );
        },
      );
      request.on("error", reject);
      request.end();
    });
  try {
    const page = await get("/");
    assert.equal(page.status, 200);
    assert.ok(page.body.includes("AutoSpine 動畫知識庫"));
    assert.equal(page.headers["referrer-policy"], "strict-origin-when-cross-origin");
    assert.equal((await get("/index.html?view=videos")).status, 200);
    assert.equal((await get("/", "HEAD")).body, "");
    for (const path of ["/catalog.json", "/../package.json", "/.env"])
      assert.equal((await get(path)).status, 404);
    assert.equal((await get("/", "POST")).status, 405);
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test("image references retain attribution, action and form categories without claiming timing", () => {
  const entry = catalog.entries.find((item) => item.source.kind === "image");
  assert.ok(entry);
  assert.ok(searchEntries(catalog, "踢擊 連續姿勢圖").some((item) => item.id === entry.id));
  const html = renderIndex(catalog);
  assert.ok(html.includes('data-kind-filter="image"'));
  assert.ok(html.includes('data-form="pose-sequence"'));
  assert.ok(html.includes('data-action="dodge tumble kick"'));
  assert.ok(html.includes("原作者未確認"));
  assert.ok(!html.includes("codex-clipboard"));
  const data = copy();
  data.entries.find((item) => item.id === entry.id).review.timingBasis = "continuous-video";
  assert.ok(validateCatalog(data).some((error) => error.includes("still images cannot claim")));
});

test("image collection rejects unknown categories, unsafe URLs and resized duplicates", () => {
  const data = copy(),
    entry = data.entries.find((item) => item.source.kind === "image");
  entry.actions = ["invented-action"];
  entry.source.imageUrl = "javascript:alert(1)";
  assert.ok(validateCatalog(data).some((error) => error.includes("invalid actions")));
  assert.ok(validateCatalog(data).some((error) => error.includes("invalid image preview URL")));
  const duplicateData = copy(),
    image = duplicateData.entries.find((item) => item.source.kind === "image"),
    duplicate = clone(image);
  duplicate.id = "resized-image-copy";
  duplicate.source.url = "https://www.pinterest.com/pin/123456789012345678/";
  duplicate.source.imageUrl = image.source.imageUrl.replace("/736x/", "/originals/");
  duplicateData.entries.push(duplicate);
  assert.ok(validateCatalog(duplicateData).some((error) => error.includes("duplicate image")));
});
