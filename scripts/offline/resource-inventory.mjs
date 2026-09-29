import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "./manifest.mjs";

export async function resourceInventory(repo, output, images, docker) {
  async function inventory(directory, base = repo) {
    const result = [];
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (
        [
          "node_modules",
          "dist",
          "__pycache__",
          ".cache",
          "generated",
          "models",
          "var",
        ].includes(item.name)
      )
        continue;
      const file = path.join(directory, item.name);
      if (item.isDirectory()) result.push(...(await inventory(file, base)));
      else if (item.isFile())
        result.push({
          path: path.relative(base, file).replaceAll("\\", "/"),
          bytes: (await stat(file)).size,
          sha256: await sha256(file),
        });
    }
    return result;
  }
  const fonts = await inventory(path.join(repo, "frontend/src/assets/fonts"));
  for (const font of fonts) {
    font.included_in = images.frontend;
    font.source = font.path.includes("JetBrainsMono")
      ? "https://github.com/JetBrains/JetBrainsMono"
      : "repository:frontend/src/assets/fonts/Placebo Fiera";
    font.license = font.path.includes("JetBrainsMono")
      ? "OFL-1.1 (embedded name record 13)"
      : "not provided in repository or embedded font metadata; owner input requested";
  }
  const modelHashes = JSON.parse(
    await readFile(path.join(output, "assets/models.json"), "utf8"),
  );
  const modelNames = [
    ...new Set(
      Object.keys(modelHashes)
        .filter((p) => p.includes("/"))
        .map((p) => p.split("/")[0]),
    ),
  ];
  const modelSources = JSON.parse(
    await readFile(path.join(repo, "docs/offline-model-sources.json"), "utf8"),
  );
  if (
    modelNames.some(
      (name) =>
        !modelSources.models.some(
          (model) => model.model === name && model.status === "verified",
        ),
    )
  )
    throw new Error("Missing verified model-specific provenance");
  for (const model of modelSources.models)
    for (const file of model.files)
      if (modelHashes[file.path] !== file.sha256)
        throw new Error("Model provenance hash differs from archived asset");
  const pythonMetadata = `import importlib.metadata as m,json\nprint(json.dumps([{'name':d.metadata['Name'],'version':d.version,'license':d.metadata.get('License-Expression') or d.metadata.get('License') or [x for x in d.metadata.get_all('Classifier',[]) if x.startswith('License ::')], 'project_urls':d.metadata.get_all('Project-URL',[]),'location':str(d.locate_file(''))} for d in m.distributions()]))`;
  const parserPackages = JSON.parse(
    docker([
      "run",
      "--rm",
      "--network",
      "none",
      "--entrypoint",
      "python",
      images.parser,
      "-c",
      pythonMetadata,
    ]),
  );
  const validatorPackages = JSON.parse(
    docker([
      "run",
      "--rm",
      "--network",
      "none",
      "--entrypoint",
      "python",
      images.validator,
      "-c",
      pythonMetadata,
    ]),
  );
  const sourceFiles = [
    ...(await inventory(path.join(repo, "backend/src"))),
    ...(await inventory(path.join(repo, "backend/prisma"))),
    ...(await inventory(path.join(repo, "backend/scripts"))),
    ...(await inventory(path.join(repo, "backend/document-parser"))),
    ...(await inventory(path.join(repo, "backend/file-validator"))),
    ...(await inventory(path.join(repo, "frontend/src"))),
  ];
  for (const name of [
    "bun.lock",
    "package.json",
    "backend/package.json",
    "frontend/package.json",
    "backend/Dockerfile",
    "frontend/Dockerfile",
    "frontend/offline-entrypoint.sh",
    "compose.yaml",
  ]) {
    const file = path.join(repo, name);
    sourceFiles.push({
      path: name,
      bytes: (await stat(file)).size,
      sha256: await sha256(file),
    });
  }
  return {
    schema_version: 1,
    scope:
      "Current implemented core; no HYP/ML weights or external LLM included",
    mandatory_runtime_external_urls: [],
    preparation_only_sources: [
      "Docker image registries",
      "Bun package registry",
      "Python package registry",
      "PaddleX official model repositories",
      "ClamAV signature mirror",
    ],
    models: modelSources.models.map((model) => ({
      ...model,
      inclusion: "assets/models.tar",
    })),
    fonts,
    parser_system_font: {
      path: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      source: "Debian fonts-dejavu-core",
      license:
        "Bitstream Vera/DejaVu; /usr/share/doc/fonts-dejavu-core/copyright inside image",
      inclusion: images.parser,
    },
    signatures: {
      inclusion: "assets/clamav.tar",
      source: "existing official ClamAV databases",
      license:
        "ClamAV database COPYING inside the signed CVD/CLD; preserve archive",
      hashes: JSON.parse(
        await readFile(path.join(output, "assets/clamav.json"), "utf8"),
      ),
    },
    dictionaries: {
      inclusion: "catalog.json and OCR inference.yml",
      source: "provided requirements and pinned model assets",
      license:
        "requirements supplied for project; OCR dictionary follows model distribution",
    },
    browser_resources: {
      inclusion: images.frontend,
      external_cdn: false,
      source: "frontend build and locally bundled assets",
    },
    python_packages: { parser: parserPackages, validator: validatorPackages },
    source_files: sourceFiles.sort((a, b) => a.path.localeCompare(b.path)),
    license_review:
      "Inventory records supplied metadata; unknown Placebo Fiera provenance remains explicit and is not presented as an approved license.",
  };
}
