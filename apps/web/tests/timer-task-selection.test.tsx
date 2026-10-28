import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { TimerPanel } from "../src/features/focus/TimerPanel";
vi.mock("../src/app/providers",()=>({useSession:()=>({session:{user:{id:"owner"}},read:vi.fn()})}));
vi.mock("@tanstack/react-query",()=>({useQuery:()=>({data:[],isPending:false})}));
it("selects a task without a Pomodoro goal and uses its custom duration",async()=>{
  const start=vi.fn();
  render(<TimerPanel task={{id:"task",title:"No goal",estimatedPomodoros:null,focusMinutes:40} as any} settings={{focusMinutes:25,shortBreakMinutes:5,longBreakMinutes:15} as any} focus={{state:{},start,remaining:0,blocked:false,command:{},query:{}} as any} onClose={()=>{}} onFree={()=>{}} />);
  expect(screen.getByRole("spinbutton")).toHaveValue(40);
  await userEvent.click(screen.getByRole("button",{name:"Start session"}));
  expect(start).toHaveBeenCalledWith("focus","task",40);
});
