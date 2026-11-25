import React, { useMemo, useState } from 'react';

function formatDateTime(value) {
  if (!value) return '-';

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return value;
  }

  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function shortNumber(value) {
  return Number(value || 0).toLocaleString('en-IN');
}

export default function RejectionAnalysis({
  data,
  loading = false,
  selectedHour = null,
  onSelectHour,
}) {
  const [activeTab, setActiveTab] = useState('hourly');

  const summary = data?.summary || {};

  const hourly = useMemo(() => {
    return (data?.hourly || []).filter(
      (x) => x.hour >= 9 && x.hour <= 21
    );
  }, [data]);

  const models = data?.models || [];
  const reasons = data?.reasons || [];
  const recent = data?.recent || [];

  const maxHourly = Math.max(
    1,
    ...hourly.map((x) => Number(x.rejectionQty || 0))
  );

  const maxModel = Math.max(
    1,
    ...models.map((x) => Number(x.rejectionQty || 0))
  );

  const maxReason = Math.max(
    1,
    ...reasons.map((x) => Number(x.rejectionQty || 0))
  );

  if (loading) {
    return (
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm border border-slate-200 p-2.5 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-fs-18 font-extrabold text-slate-900">
              Rejection Analysis
            </h2>
            <p className="text-fs-13 text-slate-600 mt-1">
              Loading rejection data...
            </p>
          </div>

          <div className="animate-pulse h-8 w-24 rounded bg-white" />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-24 rounded-lg bg-white animate-pulse"
            />
          ))}
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm border border-slate-200 p-2.5 shadow-sm">
        <h2 className="text-fs-18 font-extrabold text-slate-900">
          Rejection Analysis
        </h2>

        <p className="text-fs-13 text-slate-600 mt-2">
          No rejection data available.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-1.5">

      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-1.5">
        <div>
          <h2 className="text-fs-18 sm:text-fs-18 font-extrabold text-slate-950">
            Rejection Analysis
          </h2>

          
        </div>

        <div className="text-fs-13 font-mono text-slate-600 md:pr-10">
          {data.from} → {data.to}
        </div>
      </div>


      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">

        <MetricCard
          title="Total Rejections"
          value={shortNumber(summary.totalRejections)}
          subtitle="False scan records"
        />

        <MetricCard
          title="Successful Scans"
          value={shortNumber(summary.successfulQty)}
          subtitle="Valid production scans"
        />

        <MetricCard
          title="Total Attempts"
          value={shortNumber(summary.totalAttempts)}
          subtitle="Successful + rejected"
        />

        <MetricCard
          title="Rejection Rate"
          value={`${Number(summary.rejectionRate || 0).toFixed(2)}%`}
          subtitle="Rejected / total attempts"
        />

      </div>


      {/* TABS */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm border border-slate-200 overflow-hidden shadow-sm">

        <div className="border-b border-slate-200 px-2.5 py-2 flex flex-wrap gap-1.5">

          <TabButton
            active={activeTab === 'hourly'}
            onClick={() => setActiveTab('hourly')}
          >
            Hourly
          </TabButton>

          <TabButton
            active={activeTab === 'model'}
            onClick={() => setActiveTab('model')}
          >
            Model Wise
          </TabButton>

          <TabButton
            active={activeTab === 'reason'}
            onClick={() => setActiveTab('reason')}
          >
            Rejection Reasons
          </TabButton>

          <TabButton
            active={activeTab === 'recent'}
            onClick={() => setActiveTab('recent')}
          >
            Recent Records
          </TabButton>

        </div>


        {/* HOURLY */}
        {activeTab === 'hourly' && (
          <div className="p-2.5">

            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-fs-13 font-bold text-slate-950">
                  Rejection by Hour
                </h3>

                <p className="text-fs-13 text-slate-600">
                  Shop-floor window: 09:00–21:00
                </p>
              </div>

            </div>

            <div className="space-y-2">

              {hourly.map((item) => {

                const qty = Number(item.rejectionQty || 0);

                const width =
                  qty > 0
                    ? Math.max((qty / maxHourly) * 100, 3)
                    : 0;

                const selected =
                  selectedHour === item.hour;

                return (
                  <button
                    key={item.hour}
                    type="button"
                    onClick={() =>
                      onSelectHour?.(item.hour)
                    }
                    className={[
                      'w-full text-left rounded-lg p-2 transition',
                      selected
                        ? 'bg-red-600/10 ring-1 ring-red-500/40'
                        : 'hover:bg-white',
                    ].join(' ')}
                  >

                    <div className="flex items-center gap-1.5">

                      <div className="w-20 shrink-0">
                        <span className="text-fs-13 font-mono text-slate-600">
                          {item.label}
                        </span>
                      </div>

                      <div className="flex-1">

                        <div className="h-7 bg-white rounded-md overflow-hidden">

                          <div
                            className="h-full bg-red-600/70 rounded-md transition-all"
                            style={{
                              width: `${width}%`,
                            }}
                          />

                        </div>

                      </div>

                      <div className="w-16 text-right">
                        <span className="text-fs-13 font-bold text-red-600">
                          {shortNumber(qty)}
                        </span>
                      </div>

                    </div>

                  </button>
                );
              })}

            </div>

          </div>
        )}


        {/* MODEL */}
        {activeTab === 'model' && (
          <div className="p-2.5">

            <div className="mb-2">
              <h3 className="text-fs-13 font-bold text-slate-950">
                Model-wise Rejection
              </h3>

              <p className="text-fs-13 text-slate-600 mt-1">
                Models contributing rejection records
              </p>
            </div>

            {models.length === 0 ? (
              <EmptyState text="No model-wise rejection found." />
            ) : (
              <div className="space-y-1.5">

                {models.map((item) => {

                  const qty = Number(item.rejectionQty || 0);

                  const width =
                    Math.max(
                      (qty / maxModel) * 100,
                      3
                    );

                  return (
                    <div
                      key={`${item.mmId}-${item.modelCode}`}
                      className="rounded-lg bg-white border border-slate-200 p-2.5"
                    >

                      <div className="flex items-center justify-between gap-1.5 mb-2">

                        <div className="min-w-0">

                          <div className="text-fs-13 font-bold text-slate-950 break-words">
                            {item.model || 'Unknown Model'}
                          </div>

                          <div className="text-fs-13 text-slate-600 font-mono">
                            {item.modelCode || '-'}
                          </div>

                        </div>

                        <div className="text-right shrink-0">

                          <div className="text-fs-13 font-bold text-red-600">
                            {shortNumber(qty)}
                          </div>

                          <div className="text-fs-12 text-slate-600">
                            rejections
                          </div>

                        </div>

                      </div>

                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">

                        <div
                          className="h-full bg-red-600/70 rounded-full"
                          style={{
                            width: `${width}%`,
                          }}
                        />

                      </div>

                    </div>
                  );
                })}

              </div>
            )}

          </div>
        )}


        {/* REASONS */}
        {activeTab === 'reason' && (
          <div className="p-2.5">

            <div className="mb-2">
              <h3 className="text-fs-13 font-bold text-slate-950">
                Rejection Reasons
              </h3>

              <p className="text-fs-13 text-slate-600 mt-1">
                Error messages recorded in Tab_FalseScan
              </p>
            </div>

            {reasons.length === 0 ? (
              <EmptyState text="No rejection reasons found." />
            ) : (
              <div className="space-y-1.5">

                {reasons.map((item, index) => {

                  const qty = Number(item.rejectionQty || 0);

                  const width =
                    Math.max(
                      (qty / maxReason) * 100,
                      3
                    );

                  const percentage =
                    summary.totalRejections > 0
                      ? (
                          (qty /
                            summary.totalRejections) *
                          100
                        ).toFixed(1)
                      : '0.0';

                  return (
                    <div
                      key={`${item.reason}-${index}`}
                      className="bg-white border border-slate-200 rounded-lg p-2.5"
                    >

                      <div className="flex items-start justify-between gap-1.5">

                        <div className="min-w-0">

                          <div className="text-fs-13 text-slate-900 leading-5">
                            {item.reason || 'Unknown'}
                          </div>

                          <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">

                            <div
                              className="h-full bg-red-600/70 rounded-full"
                              style={{
                                width: `${width}%`,
                              }}
                            />

                          </div>

                        </div>

                        <div className="text-right shrink-0">

                          <div className="text-fs-13 font-bold text-red-600">
                            {shortNumber(qty)}
                          </div>

                          <div className="text-fs-12 text-slate-600">
                            {percentage}%
                          </div>

                        </div>

                      </div>

                    </div>
                  );
                })}

              </div>
            )}

          </div>
        )}


        {/* RECENT */}
        {activeTab === 'recent' && (
          <div className="p-2.5">

            <div className="mb-2">
              <h3 className="text-fs-13 font-bold text-slate-950">
                Recent Rejection Records
              </h3>

              <p className="text-fs-13 text-slate-600 mt-1">
                Latest 100 records
              </p>
            </div>

            <div className="overflow-x-auto">

              <table className="w-full text-fs-13">

                <thead>
                  <tr className="border-b border-slate-200 text-left">

                    <th className="px-2.5 py-2 text-fs-13 text-slate-600 font-medium">
                      Time
                    </th>

                    <th className="px-2.5 py-2 text-fs-13 text-slate-600 font-medium">
                      Model
                    </th>

                    <th className="px-2.5 py-2 text-fs-13 text-slate-600 font-medium">
                      Barcode
                    </th>

                    <th className="px-2.5 py-2 text-fs-13 text-slate-600 font-medium">
                      Rejection Reason
                    </th>

                  </tr>
                </thead>

                <tbody>

                  {recent.map((item) => (

                    <tr
                      key={item.fsId}
                      className="border-b border-slate-200 hover:bg-white"
                    >

                      <td className="px-2.5 py-2 whitespace-nowrap">

                        <div className="text-fs-13 font-mono text-slate-600">
                          {formatDateTime(item.dateTime)}
                        </div>

                      </td>

                      <td className="px-2.5 py-2">

                        <div className="text-fs-13 text-slate-900">
                          {item.model || '-'}
                        </div>

                        <div className="text-fs-12 font-mono text-slate-600">
                          {item.modelCode || '-'}
                        </div>

                      </td>

                      <td className="px-2.5 py-2">

                        <span className="text-fs-13 font-mono text-slate-900">
                          {item.barcode || '-'}
                        </span>

                      </td>

                      <td className="px-2.5 py-2">

                        <span className="inline-flex px-2 py-1 rounded-md bg-red-600/10 text-red-600 text-fs-13">
                          {item.reason || 'Unknown'}
                        </span>

                      </td>

                    </tr>

                  ))}

                </tbody>

              </table>

              {recent.length === 0 && (
                <EmptyState text="No rejection records found." />
              )}

            </div>

          </div>
        )}

      </div>

    </section>
  );
}


function MetricCard({ title, value, subtitle }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm border border-slate-200 p-2.5">

      <div className="text-fs-13 text-slate-600 uppercase tracking-wide">
        {title}
      </div>

      <div className="text-fs-28 font-bold text-slate-900 mt-2">
        {value}
      </div>

      <div className="text-fs-13 text-slate-600 mt-1">
        {subtitle}
      </div>

    </div>
  );
}


function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'px-2.5 py-2 rounded-md text-fs-13 font-medium transition',
        active
          ? 'bg-blue-800 text-white shadow-sm'
          : 'text-slate-600 hover:text-slate-900 hover:bg-white',
      ].join(' ')}
    >
      {children}
    </button>
  );
}


function EmptyState({ text }) {
  return (
    <div className="py-10 text-center text-fs-13 text-slate-600">
      {text}
    </div>
  );
}