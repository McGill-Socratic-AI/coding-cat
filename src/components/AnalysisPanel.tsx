import { Stack, Button, Box, Typography, Checkbox } from "@mui/joy";
import { useState } from "react";
import {Usage, AnalyzeError} from '../types';
import Markdown from "markdown-to-jsx";

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; analysis: string; usage: Usage }
  | { status: 'error'; kind: AnalyzeError['kind']; message: string; retryAt?: string; usage?: Usage };

type AnalysisPanelProps = {
  state: State;
  onAnalyze: () => void | Promise<void>;
}


export default function AnalysisPanel({state, onAnalyze}:AnalysisPanelProps){
    const [acknowledged, setAcknowledged] = useState(() => {
        return localStorage.getItem("aiAnalysisAck") === "true";
    });
    const handleAckChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.checked;
        setAcknowledged(value);
        if (value) {
            localStorage.setItem("aiAnalysisAck", "true");
        } else {
            localStorage.removeItem("aiAnalysisAck");
        }
    };
    return (
        <Stack spacing={3} sx={{ p: 3 }}>

        <Box sx={{ p: 2, borderRadius: 2, backgroundColor: "background.level1",}}>
          <Checkbox
            checked={acknowledged}
            onChange={handleAckChange}
            label="I understand that my code and the AI response may be stored to improve this feature."
          />
        </Box>
        
        {acknowledged && (['idle', 'success'].includes(state.status) ? (
          <Button size="lg" onClick={onAnalyze}>
            Generate Analysis
          </Button>
        ): state.status === 'loading' && <Typography sx={{ textAlign: "center", fontStyle: "italic",}}>
            Loading...
            </Typography>)}
        
        {state.status === 'success' && <Box sx={{ mt: 2, p: 2, borderRadius: 3, border: "1.5px solid", borderColor: "primary.500", backgroundColor: "primary.50", 
            width: "100%", minHeight: 40, height: "fit-content",}}>
            <Typography level="title-md" sx={{ mb: 1, textAlign: "center", whiteSpace: "nowrap",fontStyle: "italic"}}>
                {state.usage.dailyUsed}/20 AI analyses used today, {state.usage.problemUsed}/5 used today on this problem.
            </Typography>
            <Markdown>{state.analysis}</Markdown> 

        </Box> }

        {state.status === 'error' && <Box>
            <Typography sx={{whiteSpace:"pre-wrap",}}><strong>Error: {state.kind}.</strong> {state.message} </Typography>
            {state.retryAt && <Typography> Try again after {state.retryAt}. </Typography>}
            {state.usage && <Typography> {state.usage.dailyUsed}/20 AI analyses used today, {state.usage.problemUsed}/5 used today on this problem. </Typography>}
            {['upstream', 'unknown'].includes(state.kind) && acknowledged && <Box sx={{ mt: 1, display: "flex", justifyContent: "center" }}>
                <Button size="md" onClick={onAnalyze}> Try Again </Button>
                </Box>}
            </Box>}
      </Stack>)
}