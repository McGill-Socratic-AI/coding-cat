import { useState, useEffect, useRef } from 'react';

import { Problem, EvalResponse } from '../types';

import type { Session } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient';

export type Eval = [EvalResponse | null, (code: string) => void];

export default function useEval(
  problem: Problem, 
  session: Session | null, 
  refetchProgress: () => void,
  sessionId?: string | null,
  problemStartRef?: React.MutableRefObject<number | null>
): Eval {
    const [evalResponse, setEvalResponse] = useState<EvalResponse | null>(null)
    const currentCodeRef = useRef<string>('');

    // Set eval response to null every time the problem changes
    useEffect(() => { 
        setEvalResponse(null); 
    }, [problem]);

    // Registers an event that runs whenever proxy.py responds with eval_finished
    useEffect(() => {
        const onEvalFinished: EventListener = async (e) => {
            const isMutation = problem.meta.question_type[0] === "mutation";
            const response = (e as CustomEvent).detail;
            setEvalResponse(response);
            
            // constructing json submission object to store in the database
            if(response.status === 'success' && session?.user){
                let numPassed: number
                let totalTests: number
                if (problem.meta.question_type[0] === "mutation"){
                    totalTests = problem.mutations?.length ?? 0;
                    const mutationResults = new Map<number, Set<boolean>>()
                    for (const row of response.report as any[]){
                        if(!row?.solution?.equal) continue;
                        row.mutations.forEach((mutation: any, index: number) => {
                            if(!mutationResults.has(index)) mutationResults.set(index, new Set())
                                mutationResults.get(index)!.add(mutation.equal)
                        })
                    }
                    numPassed = 0
                    mutationResults.forEach(outcomeSet => {
                        if (outcomeSet.has(true) && outcomeSet.has(false)){
                            numPassed ++;
                        }
                    })
                }
                else{
                    numPassed = response.report.filter((r: any) => r.equal).length;
                    totalTests = response.report.length;
                }


                // Creates the submission payload and checks to see if it is a mutation first or just a regular question
                const submissionPayload = isMutation
                    ? currentCodeRef.current
                    : { code: currentCodeRef.current }
    
                // Calculate time spent on this problem
                const timeSpentSeconds = problemStartRef?.current 
                  ? Math.floor((Date.now() - problemStartRef.current) / 1000)
                  : 0;

                const isSuccessful = numPassed === totalTests;

                // Submission payload
                const submission = {
                    problem_title: problem.meta.name,
                    problem_category: problem.meta.category,
                    code: submissionPayload,
                    passed_tests: numPassed,
                    total_tests: totalTests,
                    submitted_at: new Date().toISOString(),
                    profile_id: session.user.id,
                    question_type: problem.meta.question_type[0],
                    successful: isSuccessful,
                    time_spent_seconds: timeSpentSeconds,
                    ...(sessionId && { session_id: sessionId })
                };
                // Retrieve the most recent submission in the db
                const { data, error } = await supabase
                    .from('submissions')
                    .select("submission_id, code")
                    .eq('profile_id', session.user.id)
                    .eq('problem_title', problem.meta.name)
                    .order('submitted_at', { ascending: false})
                    .limit(1);

                if(error) {
                    throw Error(error.details)
                }

                //Get the json data of the submission or null if there is none
                const json = data?.[0] || null;

                // if the most recent submission is the exact same as the new one, don't insert a new one into the db
                if (json && JSON.stringify(json.code) === JSON.stringify(submissionPayload)) {
                    const { error } = await supabase
                        .from('submissions')
                        .update({ 'submitted_at': new Date().toISOString() })
                        .eq('submission_id', json.submission_id)
                    if(error) console.error(error);
                    else refetchProgress();
                } else {
                    const { error } = await supabase.from('submissions').insert([submission]);
                    if(error) console.error(error);
                    else refetchProgress();
                }
            }
        };

        // Subscribes to the eval_finished event
        document.addEventListener('eval_finished', onEvalFinished);

        // Removes event listener on unmounting
        return () => {
            document.removeEventListener('eval_finished', onEvalFinished);
        };
    }, [problem, session, refetchProgress]);

    // function that is ran once the run button is clicked takes you to the worker file
    function runCode(code: string) {
        currentCodeRef.current = code;
        const detail: any = {
            code,
            tests: problem.io,
            name: problem.meta.name,
            question_type: problem.meta.question_type[0],
        };
        if (problem.meta.question_type[0] === 'mutation') {
            if (problem.solution)  detail.solution  = problem.solution;
            if (problem.mutations) detail.mutations = problem.mutations;
        }
        document.dispatchEvent(new CustomEvent('eval', { detail }));
    }

    return [evalResponse, runCode];
}

