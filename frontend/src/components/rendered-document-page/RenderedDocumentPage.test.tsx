import {
  createRegionalParseResult,
  parsedFile,
} from "@/api/types/parsing-test-fixtures";
import { render, screen } from "@testing-library/react";
import { RenderedDocumentPage } from "./RenderedDocumentPage";

vi.mock("@/api/hooks/use-parsing", () => ({
  useRenderedPage: () => ({
    data: new Blob(["synthetic image"]),
    isPending: false,
    isError: false,
  }),
  parsingErrorMessage: () => "error",
}));
vi.mock("@/api/hooks/use-admin-documents", () => ({
  useAdminRenderedPage: () => ({}),
}));

describe("versioned native locators", () => {
  it("highlights a selected hidden native block and explains its provenance without exposing hidden neighbours", () => {
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:synthetic");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const page = createRegionalParseResult().artifact.pages[0]!;
    const block = page.blocks[2]!;
    block.native_valid = true;
    block.provenance = {
      schema_version: 1,
      status: "selected",
      method: "native",
      fragments: [
        {
          source: "native",
          native_valid: true,
          raw_text: block.raw_text,
          bbox: [...block.bbox],
          role: "selected",
        },
      ],
      reasons: [],
    };
    block.table_link = {
      schema_version: 1,
      status: "ambiguous",
      table_id: null,
      rows: [0],
      columns: [0],
      reasons: ["TABLE_LINK_TARGET_UNRESOLVED"],
    };
    const { unmount } = render(
      <RenderedDocumentPage
        file={parsedFile}
        objectId="synthetic-object"
        page={page}
        zoom="fit"
        selectedId={block.id}
        matchIds={new Set()}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Неопределённая подпись/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.queryByRole("button", { name: /Размер −250/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Текстовый слой PDF прошёл проверку читаемости."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Связь с ячейками таблицы неоднозначна/),
    ).toBeInTheDocument();
    expect(screen.getByText(`PDF: ${block.raw_text}`)).toBeInTheDocument();
    unmount();
    create.mockRestore();
    revoke.mockRestore();
  });
});
