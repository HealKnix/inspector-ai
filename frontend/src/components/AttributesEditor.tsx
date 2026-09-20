import {
  Checkbox,
  Input,
  Label,
  ListBox,
  Select,
  TextField,
} from "@heroui/react";

import { BOOLEAN_ATTRIBUTES, type AttributesDraft } from "./attributes-draft";

export function AttributesEditor({
  draft,
  onChange,
}: {
  draft: AttributesDraft;
  onChange: (next: AttributesDraft) => void;
}) {
  return (
    <fieldset className="border-border space-y-3 rounded-2xl border p-4">
      <legend className="text-copy-muted px-1 text-xs">
        Атрибуты объекта — определяют эталонный состав документации
      </legend>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {BOOLEAN_ATTRIBUTES.map(({ key, label }) => (
          <Checkbox
            key={key}
            isSelected={draft.booleans[key] ?? false}
            onChange={(selected) =>
              onChange({
                ...draft,
                booleans: { ...draft.booleans, [key]: selected },
              })
            }
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <span className="text-sm">{label}</span>
            </Checkbox.Content>
          </Checkbox>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          aria-label="Назначение объекта"
          className="w-full"
          placeholder="Назначение объекта"
          value={draft.purpose || null}
          onChange={(value) =>
            onChange({
              ...draft,
              purpose: typeof value === "string" ? value : "",
            })
          }
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="production" textValue="Производственное">
                Производственное
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="non_production" textValue="Непроизводственное">
                Непроизводственное
                <ListBox.ItemIndicator />
              </ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>
        <TextField className="w-full">
          <Label>Инженерные системы</Label>
          <Input
            placeholder="ЭОМ, ВК, ОВ, СС — через запятую"
            value={draft.engineering_systems}
            onChange={(event) =>
              onChange({ ...draft, engineering_systems: event.target.value })
            }
          />
        </TextField>
      </div>
    </fieldset>
  );
}
