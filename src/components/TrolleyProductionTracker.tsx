import React, { useState } from 'react';
import { TrolleyProduction } from '../types';
import { Boxes, Plus, Trash2, Calendar, Users, ClipboardList, TrendingUp } from 'lucide-react';

interface TrolleyProductionProps {
  trolleys: TrolleyProduction[];
  onSaveTrolley: (trolley: TrolleyProduction) => void;
  onDeleteTrolley: (id: string) => void;
}

export const TrolleyProductionTracker: React.FC<TrolleyProductionProps> = ({
  trolleys,
  onSaveTrolley,
  onDeleteTrolley,
}) => {
  const [productionDate, setProductionDate] = useState<string>(
    new Date().toISOString().substring(0, 10)
  );
  const [teamName, setTeamName] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(0);
  const [notes, setNotes] = useState<string>('');
  
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  const [searchQuery, setSearchQuery] = useState<string>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!productionDate) {
      setErrorMsg('Production Date is required.');
      return;
    }
    if (!teamName.trim()) {
      setErrorMsg('Team Name is required.');
      return;
    }
    if (quantity <= 0) {
      setErrorMsg('Quantity must be greater than 0.');
      return;
    }

    const newRecord: TrolleyProduction = {
      id: `trolley_prod_${Date.now()}`,
      date: productionDate,
      teamName: teamName.trim(),
      quantityProduced: quantity,
      notes: notes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    try {
      onSaveTrolley(newRecord);
      setSuccessMsg(`Successfully logged production of ${quantity} trolleys!`);
      setQuantity(0);
      setNotes('');
      setTeamName('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save trolley production log.');
    }
  };

  // KPI Calculations
  const totalProduced = trolleys.reduce((sum, item) => sum + (item.quantityProduced || 0), 0);
  
  const todayStr = new Date().toISOString().substring(0, 10);
  const todaysYield = trolleys
    .filter((item) => item.date === todayStr)
    .reduce((sum, item) => sum + (item.quantityProduced || 0), 0);

  // Group by team performance
  const teamYields: Record<string, number> = {};
  trolleys.forEach((item) => {
    teamYields[item.teamName] = (teamYields[item.teamName] || 0) + (item.quantityProduced || 0);
  });
  let topTeam = 'N/A';
  let topTeamYield = 0;
  Object.entries(teamYields).forEach(([team, yieldVal]) => {
    if (yieldVal > topTeamYield) {
      topTeamYield = yieldVal;
      topTeam = team;
    }
  });

  // Filter lists
  const filteredTrolleys = trolleys.filter((item) => {
    if (!searchQuery) return true;
    const match = searchQuery.toLowerCase();
    return (
      item.teamName.toLowerCase().includes(match) ||
      (item.notes && item.notes.toLowerCase().includes(match)) ||
      item.date.includes(match)
    );
  }).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-6">
      
      {/* Upper Segment: Welcome and Title */}
      <div className="bg-slate-55 border-b border-slate-100 pb-3 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            <Boxes className="h-6 w-6 text-rose-550 text-rose-600" />
            Trolley Production Ledger
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Record and supervise trolley manufacturing throughput separate from pool fabrication.
          </p>
        </div>
      </div>

      {/* Analytics Summaries */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        
        {/* Card 1: Total Produced */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex items-center gap-4">
          <div className="bg-rose-50 p-3 rounded-xl text-rose-600">
            <Boxes className="h-6 w-6" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-black tracking-wider text-slate-400 block font-mono">Total Cumulative Yield</span>
            <span className="text-2xl font-black text-slate-800 font-mono tracking-tight">{totalProduced}</span>
            <span className="text-[10.5px] text-slate-400 block">Trolleys registered in stock</span>
          </div>
        </div>

        {/* Card 2: Today's Yield */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex items-center gap-4">
          <div className="bg-emerald-50 p-3 rounded-xl text-emerald-600">
            <Calendar className="h-6 w-6" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-black tracking-wider text-slate-400 block font-mono">Today's Production Yield</span>
            <span className="text-2xl font-black text-slate-850 text-slate-800 font-mono tracking-tight">{todaysYield}</span>
            <span className="text-[10.5px] text-slate-400 block">Target: Continuous optimization</span>
          </div>
        </div>

        {/* Card 3: Top Workteam */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex items-center gap-4">
          <div className="bg-amber-50 p-3 rounded-xl text-amber-600">
            <TrendingUp className="h-6 w-6" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-black tracking-wider text-slate-400 block font-mono">Lead Production Team</span>
            <span className="text-lg font-bold text-slate-800 truncate block max-w-[180px]">{topTeam}</span>
            <span className="text-[10.5px] text-slate-400 block">Yield: {topTeamYield} trolley units</span>
          </div>
        </div>

      </div>

      {/* Main Content Pane */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Form Section */}
        <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-xs h-fit">
          <h3 className="text-sm font-black text-slate-800 mb-4 pb-2 border-b border-slate-100 uppercase tracking-wide flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-rose-500" />
            Log Daily Quantity
          </h3>

          <form onSubmit={handleSubmit} className="space-y-4">
            
            {/* Input: Date */}
            <div>
              <label className="text-[10.5px] font-black text-slate-500 block uppercase mb-1 font-mono">Production Date</label>
              <div className="relative">
                <input
                  type="date"
                  value={productionDate}
                  onChange={(e) => setProductionDate(e.target.value)}
                  className="w-full bg-slate-55 bg-slate-50 border border-slate-200 text-xs px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>
            </div>

            {/* Input: Team Name */}
            <div>
              <label className="text-[10.5px] font-black text-slate-500 block uppercase mb-1 font-mono">Executing Team Name</label>
              <input
                type="text"
                required
                value={teamName}
                placeholder="e.g. Assembly Shop Team 3"
                onChange={(e) => setTeamName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-xs px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
              <span className="text-[9.2px] text-slate-400 block mt-1 leading-none">Specify team name tracking this yield.</span>
            </div>

            {/* Input: Quantity */}
            <div>
              <label className="text-[10.5px] font-black text-slate-500 block uppercase mb-1 font-mono">Quantity Produced (Units)</label>
              <input
                type="number"
                required
                min="1"
                placeholder="0"
                value={quantity || ''}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
                className="w-full bg-slate-50 border border-slate-200 text-xs px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-rose-500 font-mono font-bold"
              />
            </div>

            {/* Input: Notes */}
            <div>
              <label className="text-[10.5px] font-black text-slate-500 block uppercase mb-1 font-mono">Operational Notes (Optional)</label>
              <textarea
                value={notes}
                placeholder="e.g. Seamless build. Day shift output."
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full bg-slate-50 border border-slate-200 text-xs px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
            </div>

            {errorMsg && (
              <div className="p-2.5 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-xs font-semibold leading-tight">
                {errorMsg}
              </div>
            )}

            {successMsg && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-800 text-xs font-semibold leading-tight animate-pulse">
                {successMsg}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              <span>Log Production</span>
            </button>

          </form>
        </div>

        {/* Right Column: List Section */}
        <div className="lg:col-span-8 bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex flex-col justify-between min-h-[500px]">
          
          <div className="space-y-4 flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-2 border-b border-slate-100 gap-3">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
                <Users className="h-4 w-4 text-rose-605 text-rose-600 animate-pulse" />
                Ledger Logs History
              </h3>
              
              <div className="relative">
                <input
                  type="text"
                  placeholder="Filter ledger records..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-slate-50 border border-slate-200 text-xs px-3 py-1.5 rounded-lg w-56 focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>
            </div>

            {/* List Table */}
            {filteredTrolleys.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-655 border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase tracking-wider text-[9.5px] font-mono">
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Team Name</th>
                      <th className="py-2 px-3 text-center">Batch Quantity</th>
                      <th className="py-2 px-3">Executive Notes</th>
                      <th className="py-2 px-3 text-right">Verification</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrolleys.map((trolley) => (
                      <tr key={trolley.id} className="border-b border-slate-50/75 hover:bg-slate-50/50 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-slate-800 font-mono">{trolley.date}</td>
                        <td className="py-2.5 px-3 font-medium text-slate-700">{trolley.teamName}</td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="bg-rose-50 border border-rose-100 text-rose-700 px-2.5 py-1 text-xs rounded-md font-mono font-extrabold shadow-2xs">
                            {trolley.quantityProduced} units
                          </span>
                        </td>
                        <td className="py-2.5 px-3 max-w-[200px] truncate text-slate-500 italic">
                          {trolley.notes || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right text-[10px] text-slate-400 font-mono italic">
                          Registered (Management Auth Only for deletion)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center text-slate-400 border border-dashed border-slate-100 rounded-xl space-y-1 bg-slate-50/50">
                <Boxes className="h-8 w-8 text-slate-300 mx-auto" />
                <p className="text-xs font-semibold text-slate-500 mt-2">No Trolley Records Found</p>
                <p className="text-[10px] text-slate-400">Fill in the log panel on the left to register a daily production batch.</p>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-100 text-[10px] text-slate-400 font-mono flex items-center justify-between">
            <span>Showing {filteredTrolleys.length} in history ledger</span>
            <span>MAT PLASTIC MFG • SECURITY AUTHORISED SYSTEM</span>
          </div>

        </div>

      </div>

    </div>
  );
};
