import { PanelSkeleton } from "@/components/common/loading";

export default function BillDetailLoading() {
  return (
    <div className="space-y-5">
      <PanelSkeleton lines={3} />
      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <PanelSkeleton lines={10} />
        <div className="space-y-5">
          <PanelSkeleton lines={5} />
          <PanelSkeleton lines={3} />
          <PanelSkeleton lines={3} />
        </div>
      </div>
    </div>
  );
}
