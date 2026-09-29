import { apiClient } from "@/api/client";
import {
  releaseListSchema,
  releaseSchema,
  type SelectedRule,
} from "@/api/types/rule-set-release";
import { Button } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
const key = ["matrix", "releases"] as const;
export function MatrixReleases({
  selected,
  onRemove,
}: {
  selected: SelectedRule[];
  onRemove: (code: string) => void;
}) {
  const client = useQueryClient();
  const [full, setFull] = useState(false);
  const list = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) =>
      releaseListSchema.parse(
        (await apiClient.get<unknown>("/v1/admin/matrix/releases", { signal }))
          .data,
      ),
  });
  const build = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<{ release: unknown }>(
        "/v1/admin/matrix/releases",
        {
          mode: full ? "full" : "partial",
          rule_ids: selected.map((r) => r.id),
        },
      );
      return releaseSchema.parse(response.data.release);
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
  const publish = useMutation({
    mutationFn: async (id: string) =>
      apiClient.post(`/v1/admin/matrix/releases/${id}/publish`, {
        expected_active_release_id: list.data?.active_release_id ?? null,
      }),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
  const error = list.error ?? build.error ?? publish.error;
  return (
    <section
      className="border-border space-y-3 rounded-xl border p-4"
      aria-label="Выпуски правил"
    >
      <h2 className="font-semibold">Выпуски правил</h2>
      <p className="text-copy-muted text-sm">
        Выберите утверждённые версии в карточках ниже. Сервер проверит паспорта
        и регрессию перед сборкой. Публикация применяется к новым запускам.
      </p>
      <div className="flex flex-wrap gap-2">
        {selected.map((r) => (
          <Button
            key={r.parameterCode}
            size="sm"
            variant="outline"
            onPress={() => onRemove(r.parameterCode)}
          >
            {r.parameterCode} · v{r.version} · убрать
          </Button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={full}
          onChange={(e) => setFull(e.target.checked)}
        />
        Полный выпуск — все 132 параметра
      </label>
      <Button
        size="sm"
        isDisabled={!selected.length || (full && selected.length !== 132)}
        isPending={build.isPending}
        onPress={() => build.mutate()}
      >
        Собрать выпуск ({selected.length}/132)
      </Button>
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error.message}
        </p>
      )}
      {list.isPending && <p role="status">Загружаем выпуски…</p>}
      <ul className="space-y-2">
        {list.data?.releases.map((release) => (
          <li
            key={release.id}
            className="border-border rounded-lg border p-3 text-sm"
          >
            <p className="font-medium">
              {release.manifest.mode === "legacy_capture"
                ? "Исторический снимок без нового допуска"
                : release.manifest.mode === "full"
                  ? "Полный выпуск"
                  : "Проверенная партия"}{" "}
              · {release.manifest.entries.length}/132 ·{" "}
              {new Date(release.createdAt).toLocaleString("ru-RU")}
            </p>
            <p className="text-copy-muted break-all">{release.manifestHash}</p>
            <details className="my-2">
              <summary>Состав и версии</summary>
              <ul>
                {release.manifest.entries.map((e) => (
                  <li key={e.parameter_code}>
                    {e.parameter_code} · v{e.version}
                  </li>
                ))}
              </ul>
              <p>
                Вне партии:{" "}
                {release.manifest.omitted_parameter_codes.join(", ") || "нет"}
              </p>
            </details>
            {release.id === list.data.active_release_id ? (
              <p className="text-success">Выбран для новых запусков</p>
            ) : (
              release.manifest.mode !== "legacy_capture" && (
                <Button
                  size="sm"
                  variant="outline"
                  isPending={publish.isPending}
                  onPress={() => publish.mutate(release.id)}
                >
                  Выбрать для новых запусков
                </Button>
              )
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
