import { getFinding, getProtocol, listFindings } from "./verification";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/api/client", () => ({ apiClient: { get } }));
const objectId = "11111111-1111-4111-8111-111111111111";
const protocolId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";

beforeEach(() => get.mockReset());

it("rejects a different protocol instead of displaying its cached findings", async () => {
  get.mockResolvedValue({
    data: {
      schema_version: 1,
      object_id: objectId,
      protocol_id: otherId,
      items: [],
      findings_absent_reason: null,
    },
  });
  await expect(
    listFindings(objectId, { protocol_id: protocolId }),
  ).rejects.toMatchObject({ status: 409 });
  expect(get).toHaveBeenCalledWith(`/v1/objects/${objectId}/findings`, {
    params: { protocol_id: protocolId },
    signal: undefined,
  });
});

it("rejects a protocol belonging to a different object", async () => {
  get.mockResolvedValue({
    data: {
      schema_version: 1,
      object_id: otherId,
      process_status: "READY",
      protocol: null,
      versions: [],
      protocol_absent_reason: "not_generated",
    },
  });
  await expect(getProtocol(objectId)).rejects.toMatchObject({ status: 409 });
});

it("rejects a response for a different finding", async () => {
  get.mockResolvedValue({
    data: {
      schema_version: 1,
      object_id: objectId,
      finding: {
        id: otherId,
        parameter_code: "P001",
        scope_key: "",
        status: "MISSING_EVIDENCE",
        risk: null,
        reason_code: null,
        comment: null,
        decided_at: null,
        finding_version: 1,
        gate_reasons: [],
        verdict: null,
        protocol_version: 1,
        members: [],
        decisions: [],
      },
    },
  });
  await expect(getFinding(objectId, protocolId)).rejects.toMatchObject({
    status: 409,
  });
});
