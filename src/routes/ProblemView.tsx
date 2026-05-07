import { useEffect, useState, useRef } from 'react';
import { useLoaderData, useNavigate, useOutletContext } from 'react-router-dom';
import Markdown from 'markdown-to-jsx';

import { Problem, EvalResponse } from '../types';
import useEval from '../hooks/useEval';
import usePersistentProblemCode from '../hooks/usePersistentProblemCode';

import { Stack, Sheet, Box, Typography, Table, Button } from '@mui/joy';

import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';

import ReflectionInput from '../components/ReflectionInput';
import CodingQuestion from '../components/CodingQuestion';
import MutationQuestion from '../components/MutationQuestion';
import { reflectionQuestions } from '../utils/questions';
import Tutorial from '../components/MutationTutorial';
import cursedCat from '../assets/cUrSed.png';
import SolutionCode from '../components/SolutionCode';
import { getColumnStatuses } from '../utils/mapMutantResults';
import getProblemSet from '../utils/getProblemSet';

// Emoji rendered in the report
const TEST_CASE_PASSED = '✅';
const TEST_CASE_FAILED = '❌';
const ALL_TESTS_PASSED = '🎉';

const PASS_COLOR = '#caffc5';
const FAIL_COLOR = '#f4cbca';

export async function problemLoader({params}: any): Promise<Problem> {
  const problems = await getProblemSet();
  const selected = (problems as Problem[]).filter((p) => p.meta.name === params.problemName);
  if (selected.length !== 1) throw new Error('fuck');
  return selected[0];
}

export default function ProblemView() {
  const problem = useLoaderData() as Problem;
  return (
    <>
      <ProblemIDE problem={problem} />
    </>
  );
}

interface ProblemIDEProps {
  problem: Problem
}

function ProblemIDE({ problem }: ProblemIDEProps) {
    const [code, setCode] = usePersistentProblemCode(problem);
    const [hidePrompt, setHidePrompt] = useState(true);
    const [question, setQuestion] = useState("");
    const reflectionInput = useRef<HTMLElement>(null);
    const [isTourOpen, setTourOpen] = useState(false);
    const [problems, setProblems] = useState<Problem[]>([]);
    const [problemElapsedSeconds, setProblemElapsedSeconds] = useState(0);
    const [problemAlertStage, setProblemAlertStage] = useState<null | 'half' | 'twoThirds'>(null);
    const [hideExerciseTimer, setHideExerciseTimer] = useState(false);
    const problemTimerRef = useRef<NodeJS.Timeout | null>(null);
    const problemStartRef = useRef<number | null>(null);

    const { 
      session, 
      setActiveProblem, 
      refetchProgress,
      activeSession,
      sessionId,
      sessionRemainingSeconds,
      sessionDuration,
      plannedExerciseCount
    } = useOutletContext<{
      session: Session | null,
      setActiveProblem: (name: string | null) => void,
      refetchProgress: () => void,
      activeSession: boolean,
      sessionId: string | null,
      sessionRemainingSeconds: number,
      sessionDuration: number,
      plannedExerciseCount: number
    }>();
    
    const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      setProblems(await getProblemSet());
    })();
  }, []);

  const currCategoryProblems = () => {
    const questionType = problem.meta.question_type[0];
    if(questionType.includes("mutation") || questionType.includes("haystack")){
      return problems.filter(p => p.meta.question_type.includes(questionType))
    }
    else{
      return problems.filter(p => {
        const questionType = p.meta.question_type[0];
        const exclude = questionType.includes("mutation") || questionType.includes("haystack");
        return p.meta.category === problem.meta.category && !exclude;
      })
    }
  };

  const currProblems = currCategoryProblems();
  const [currIndex, setCurrIndex] = useState(currProblems.findIndex(p => p.meta.name === problem.meta.name));


  useEffect(() => {
    setActiveProblem(problem.meta.name);
    setCurrIndex(currProblems.findIndex(p => p.meta.name === problem.meta.name))
  }, [setActiveProblem, problem.meta.name, currProblems]);

  const [evalResponse, runCode] = useEval(problem, session, refetchProgress);


  // Function for defining what reflection questions to show to user depending on success status of user code
  useEffect(() => {
    if(!evalResponse || evalResponse?.status === "failure") {
      setHidePrompt(true);
      return;
    }
    if (evalResponse.status === "success") {
      setHidePrompt(false);

      const allPassed = evalResponse.report.every((r) => r.equal);
      // if allPassed, give success questions
      // if not, give fail questions
      const questionList = allPassed
        ? reflectionQuestions.success
        : reflectionQuestions.fail;

      const rand = Math.floor(Math.random() * questionList.length);
      const question = questionList[rand];

      setQuestion(question);

      setTimeout(() => {
        reflectionInput.current?.scrollIntoView({ behavior: "smooth" });
      }, 100)
    }
  }, [evalResponse]);

  const hasFetchedProblems = useRef<Set<string>>(new Set());

  useEffect(() => {
    async function fetchLatestSubmission() {
      if (!session?.user) return;
      if (hasFetchedProblems.current.has(problem.meta.name)) return;

      const { data, error } = await supabase
        .from('submissions')
        .select('code')
        .eq('profile_id', session.user.id)
        .eq('problem_title', problem.meta.name)
        .order('submitted_at', { ascending: false })
        .limit(1);

      const json = data?.[0] || null;

      if (error) {
        console.warn('Could not load latest submission: ', error.message);
        return;
      }

      if (json) {
        if (problem.meta.question_type[0] === 'mutation') {
          setCode(json.code);
        } else {
          const stored = json.code;
          setCode(
            typeof stored === 'object' && stored !== null && 'code' in stored
              ? (stored as any).code
              : (stored as string)
          );
        }
      } else {
        if (['coding', 'haystack'].includes(problem.meta.question_type[0])) {
          setCode(problem.starter || '');
        }
        else {
          setCode('');
        }
      }
      hasFetchedProblems.current.add(problem.meta.name);
    }
    fetchLatestSubmission();

  }, [problem.meta.name, problem.meta.question_type, problem.starter, session, setCode]);

    // Problem timer - starts when problem loads
    useEffect(() => {
      problemStartRef.current = Date.now();
      setProblemElapsedSeconds(0);
      setProblemAlertStage(null);

      problemTimerRef.current = setInterval(() => {
        if (!problemStartRef.current) return;
        const elapsed = Math.floor((Date.now() - problemStartRef.current) / 1000);
        setProblemElapsedSeconds(elapsed);
      }, 1000);

      return () => {
        if (problemTimerRef.current) clearInterval(problemTimerRef.current);
      };
    }, [problem.meta.name]);

    // Alert user if taking too long on a problem
    useEffect(() => {
      if (!activeSession || plannedExerciseCount <= 0 || sessionDuration <= 0) return;

      const sessionSeconds = sessionDuration * 60;
      const perProblemTarget = Math.max(1, Math.floor(sessionSeconds / Math.max(1, plannedExerciseCount)));

      if (problemElapsedSeconds >= perProblemTarget * (2/3) && problemAlertStage !== 'twoThirds') {
        setProblemAlertStage('twoThirds');
        setHideExerciseTimer(false);
        console.warn(`You've been on this problem for ${Math.floor(problemElapsedSeconds / 60)} minutes. Consider using debugging tools or moving on.`);
      } else if (problemElapsedSeconds >= perProblemTarget / 2 && problemAlertStage !== 'half') {
        setProblemAlertStage('half');
        setHideExerciseTimer(false);
        console.log(`You've spent ${Math.floor(problemElapsedSeconds / 60)} minutes on this problem.`);
      }
    }, [problemElapsedSeconds, plannedExerciseCount, sessionDuration, activeSession, problemAlertStage]);

    function changeCode(e: string | undefined) {
      setCode(e ?? '')
    }


  function handlePreviousProblem(){
    if(currIndex > 0){
      const prevProblem = currProblems[currIndex-1].meta.name;
      setCurrIndex(currIndex-1);
      navigate(`/problems/${prevProblem}`)
    }
  }

  function handleNextProblem(){ 
    if(currIndex < currProblems.length - 1){
      const nextProblem = currProblems[currIndex+1].meta.name;
      setCurrIndex(currIndex+1);
      navigate(`/problems/${nextProblem}`)
    }
  }

  let author = problem.meta.author;
  if (author.toLowerCase() === "chatgpt") author = "";

  const statuses = evalResponse?.status === 'success'
    ? getColumnStatuses(evalResponse)
    : undefined;

  return (
    <Stack sx={{ width: "100%", p: 3 }} className="problem-container" direction="row" spacing={2}  justifyContent="center">
      <Stack sx={{ flex: 4, width: "100%", height: "100%", display: "flex"}} direction="column" spacing={2} alignItems="center">
        <Box className="navigate-problem-btn">
          <Button disabled={currIndex === 0} onClick={handlePreviousProblem}>
            <Stack direction="column" spacing={0} alignItems="center">
              <Typography level="body-md" fontFamily="inherit">Prev</Typography>
              <Typography level="body-sm" fontStyle="italic" fontFamily="inherit">
                {currProblems[currIndex - 1]?.meta?.title}
              </Typography>
            </Stack>
          </Button>
          <Button disabled={currIndex >= currProblems.length-1 } onClick={handleNextProblem}>
            <Stack direction="column" spacing={0} alignItems="center">
              <Typography level="body-md" fontFamily="inherit">Next</Typography>
              <Typography level="body-sm" fontStyle="italic" fontFamily="inherit">
                {currProblems[currIndex + 1]?.meta?.title}
              </Typography>
            </Stack>
          </Button>
        </Box>

        <Sheet sx={{ border: 2, borderRadius: 10, p: 2, display: "flex", flexDirection: "column", gap: 1, width: "99%"}}>
          <Box sx={{ width: "100%",  flexDirection: "column", gap: 1 }}>
            <Box>
              <Typography level="title-lg">{problem.meta.title}</Typography>
              { !!author && <Typography level="body-sm">Authored by {problem.meta.author}</Typography> }
            </Box>

            <Box sx={{display:"flex", alignItems: "flex-end"}}>
              <Markdown>
                {problem.description}
              </Markdown>
              {['coding','haystack'].includes(problem.meta.question_type[0]) ? <></> : <Tutorial tourState={isTourOpen} setTourState={setTourOpen}/>}
            </Box>

            {activeSession && (
              hideExerciseTimer ? (
                <Box sx={{ width: '100%', display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                  <Button
                    size="sm"
                    variant="soft"
                    color="neutral"
                    onClick={() => setHideExerciseTimer(false)}
                    sx={{ borderRadius: '999px', textTransform: 'none' }}
                  >
                    Show exercise timer
                  </Button>
                </Box>
              ) : (
                <Box sx={{
                  width: '100%',
                  mt: 2,
                  p: 1,
                  borderRadius: '999px',
                  background: 'linear-gradient(90deg, #ff9a9e 0%, #fad0c4 50%, #f9d976 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 2,
                }}>
                  <Typography level="body-md" sx={{ fontWeight: 700, color: '#3f2d2d' }}>
                    Exercise timer: {Math.floor(problemElapsedSeconds / 60)}:{(problemElapsedSeconds % 60).toString().padStart(2, '0')} elapsed
                  </Typography>
                  <Button
                    size="sm"
                    variant="plain"
                    color="neutral"
                    onClick={() => setHideExerciseTimer(true)}
                    sx={{ minWidth: '24px', px: 0, color: '#3f2d2d' }}
                  >
                    ×
                  </Button>
                </Box>
              )
            )}
          </Box>

          { ['coding','haystack'].includes(problem.meta.question_type[0]) ?
            (
              <CodingQuestion code={code} changeCode={changeCode} problem={problem} runCode={runCode} />
            ) : ( 
              <MutationQuestion code={code} setCode={changeCode} runCode={runCode} evalResponse={evalResponse} problem={problem} />
            )
          }
        </Sheet>
      </Stack>
      
      <Stack height="100%" width="100%" flex={2} alignItems="flex-start" className="results-container" gap={3}>
        { 
          ['coding','haystack'].includes(problem.meta.question_type[0]) ? (
            <Box flex={1} width="100%">
              {evalResponse ? <Report evalResponse={evalResponse} questionType={problem.meta.question_type[0]} /> : <Box></Box>}
            </Box>
          ) : 
          (
            <>
              <SolutionCode code={problem.solution} title="Problem Solution"/>
              
              {statuses &&
                problem.mutations?.map((mutCode, idx) =>
                  statuses.get(idx) === 'pass' ? (
                    <SolutionCode key={idx} code={mutCode} title={`Mutation M${idx + 1} Code`}/>
                  ) : null
                )
              }
            </>
            
          )
        }
        <Box ref={reflectionInput} flex={1} width="100%">
          {evalResponse ? <ReflectionInput hide={hidePrompt} problemName={problem.meta.name} question={question} /> : <Box></Box>}
        </Box>
      </Stack>
    </Stack>
  );
}

interface ReportProps {
  evalResponse: EvalResponse | null;
  questionType: string;
}

function Report({ evalResponse, questionType }: ReportProps) {
  if (null === evalResponse) return null;

  if ('failure' === evalResponse.status) {
    return (
      <Stack direction="column">
        <Typography> Uh-oh... There was a problem with your submission. </Typography>
        <Typography sx={{ whiteSpace: 'pre-wrap'}}> {evalResponse.message} </Typography>
      </Stack>
    )
  }

  if ('success' === evalResponse.status) {

    if(questionType === 'haystack'){
      return (
        <Table size="sm" variant="outlined"
          sx={{
            '--TableCell-headBackground': '#f5f5f5',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <thead>
            <tr>
              <th style={{ textAlign: 'center' }}>Input</th>
              <th style={{ textAlign: 'center' }}>Your output</th>
              <th style={{ textAlign: 'center' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {evalResponse.report.map((r, i) => (
              <tr key={i} style={{ backgroundColor: r.equal ? PASS_COLOR : FAIL_COLOR }}>
                <td className="mono" style={{ textAlign: 'center' }}>{r.input}</td>
                <td className="mono" style={{ textAlign: 'center' }}>{r.actual}</td>
                <td style={{ textAlign: 'center' }}>
                  {r.equal ? TEST_CASE_PASSED : TEST_CASE_FAILED}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      );
    }

    return (
      <Box sx={{ border: 2, borderRadius: 10}} >
        <Stack direction="column">
          <Typography sx={{ p: 2, borderBottom: 2 }} level="h4"> Results </Typography>
          <Table sx={{ borderRadius: 10, border: 2, borderColor: "white" }}>
            <thead>
            <tr>
              <th> Input </th>
              <th> Expected output </th>
              <th> Your output </th>
            </tr>
            </thead>
            <tbody>
            { evalResponse.report.map((r, i) =>
                <tr key={i} style={{ backgroundColor: r.equal ? PASS_COLOR : FAIL_COLOR }}>
                  <td className="mono"> {r.input} </td>
                  <td className="mono"> {r.expected} </td>
                  <td className="mono"> {r.actual} </td>
                </tr>)
            }
            </tbody>
          </Table>
          { evalResponse.report.reduce((acc, r) => r.equal && acc, true)
            ? <Box style={{ textAlign: "center"}} sx={{ borderTop: 1 }} >
                <Typography sx={{ p: 1 }} level='body-lg'>
                  Bravo {ALL_TESTS_PASSED} You completed this problem!
                </Typography>
                <img src={cursedCat} alt='cursed coding cat' height="100px"/>
              </Box>
            : null }
        </Stack>
      </Box>
    ) 
  }

  return <p> If this text appears, it&apos;s a bug :^) </p>;
};
