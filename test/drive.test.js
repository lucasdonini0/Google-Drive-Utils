const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assignUniqueNames,
  flattenDirectories,
  flattenFiles,
  parseFolderUrl,
  sanitizeName,
} = require("../src/main/drive");

test("parses standard folder links and resource keys", () => {
  assert.deepEqual(
    parseFolderUrl("https://drive.google.com/drive/folders/abc_123?resourcekey=key-1"),
    { id: "abc_123", resourceKey: "key-1" }
  );
});

test("rejects non-Drive and non-folder links", () => {
  assert.throws(() => parseFolderUrl("https://example.com/folders/abc"), /Google Drive/);
  assert.throws(() => parseFolderUrl("https://drive.google.com/file/d/abc"), /folder ID/);
});

test("sanitizes names for Windows and macOS", () => {
  assert.equal(sanitizeName('a<b>:c"d/e\\f|g?h*.'), "a_b__c_d_e_f_g_h_");
  assert.equal(sanitizeName("CON"), "_CON");
  assert.equal(sanitizeName("..."), "Untitled");
});

test("assigns deterministic suffixes to duplicate names", () => {
  const result = assignUniqueNames([
    { name: "photo.jpg" },
    { name: "PHOTO.jpg" },
    { name: "photo.jpg" },
  ]);
  assert.deepEqual(result.map((item) => item.safeName), ["photo.jpg", "PHOTO (2).jpg", "photo (3).jpg"]);
});

test("flattens nested files and empty directories", () => {
  const tree = {
    files: [{ safeName: "root.txt" }],
    folders: [
      { safeName: "Empty", files: [], folders: [] },
      { safeName: "Nested", files: [{ safeName: "file.bin" }], folders: [] },
    ],
  };
  assert.deepEqual(flattenFiles(tree), [
    { file: tree.files[0], relativePath: "root.txt" },
    { file: tree.folders[1].files[0], relativePath: "Nested/file.bin" },
  ]);
  assert.deepEqual(flattenDirectories(tree), ["Empty/", "Nested/"]);
});
