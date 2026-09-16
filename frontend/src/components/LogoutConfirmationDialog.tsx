import { AlertDialog, Button, ScrollShadow } from "@heroui/react";

interface LogoutConfirmationDialogProps {
  isOpen: boolean;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
}

export function LogoutConfirmationDialog({
  isOpen,
  isPending,
  onOpenChange,
  onConfirm,
}: LogoutConfirmationDialogProps) {
  return (
    <AlertDialog.Backdrop
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!isPending) onOpenChange(open);
      }}
      className="bg-backdrop backdrop-blur-md"
    >
      <AlertDialog.Container className="p-1.5 sm:p-4">
        <AlertDialog.Dialog className="bg-background text-foreground border-border flex max-w-[calc(100vw-12px)] flex-col overflow-hidden rounded-[24px] border p-0 shadow-[0_28px_90px_rgb(0_0_0/.34),inset_0_1px_0_rgb(255_255_255/.04)] sm:max-w-[420px] dark:bg-[#0e0f11]">
          <AlertDialog.Header className="flex h-16 shrink-0 flex-row items-center gap-4 px-4 py-0 max-[639px]:h-14 max-[639px]:px-2">
            <AlertDialog.Icon status="danger" />
            <AlertDialog.Heading>Выйти из аккаунта?</AlertDialog.Heading>
          </AlertDialog.Header>

          <div className="bg-surface border-border mx-1 mb-1 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[21px] border dark:bg-[#202124]">
            <AlertDialog.Body className="m-0 flex p-0">
              <ScrollShadow size={28} className="min-h-0 flex-1 p-4">
                <p>Вы точно уверены, что хотите выйти?</p>
              </ScrollShadow>
            </AlertDialog.Body>
            <AlertDialog.Footer className="mt-0 rounded-b-[21px] p-2 not-sm:flex-col-reverse">
              <Button
                fullWidth
                variant="ghost"
                isDisabled={isPending}
                onPress={() => onOpenChange(false)}
              >
                Остаться
              </Button>
              <Button
                fullWidth
                variant="danger"
                isPending={isPending}
                onPress={() => void onConfirm()}
              >
                Выйти
              </Button>
            </AlertDialog.Footer>
          </div>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}
