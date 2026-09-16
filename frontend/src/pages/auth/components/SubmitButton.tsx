import { Button, Spinner } from "@heroui/react";

interface SubmitButtonProps {
  isPending: boolean;
  label: string;
  pendingLabel: string;
}

export function SubmitButton({
  isPending,
  label,
  pendingLabel,
}: SubmitButtonProps) {
  return (
    <Button fullWidth isPending={isPending} size="lg" type="submit">
      {({ isPending: pending }) => (
        <>
          {pending ? <Spinner color="current" size="sm" /> : null}
          {pending ? pendingLabel : label}
        </>
      )}
    </Button>
  );
}
