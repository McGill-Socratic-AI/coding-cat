import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLoaderData, useNavigate, useLocation } from 'react-router';
import { Link } from 'react-router-dom';
import { BLANK_CONTRACT, ContractData, ContractProgress, Problem, Submission } from '../types';
import { supabase } from '../supabaseClient';
import { type Session } from '@supabase/supabase-js';
import { List as ListIcon } from '@phosphor-icons/react';
import { Typography, Box, Stack, Drawer, ModalClose, DialogTitle, DialogContent, Button, Option, Select } from '@mui/joy';
import CategoryList from '../components/CategoryList';
import whitePaw from '../assets/white_paw.webp';
import whitePawHover from '../assets/white_paw_hover.webp';
import logo from '../assets/coding-cat.png';
import ProblemList from '../components/ProblemList';
import CustomSearch from '../components/ProblemSearch';
import getProblemSet from '../utils/getProblemSet';
import { ALL_PFPS } from '../components/profile/UserInfo';
import ProfileAvatar from '../components/profile/ProfileAvatar';

interface UserData{
  name: string,
  pfp_id: number
}

// TODO: This component is huge and should be broken down into smaller components.
// The main thing that needs to be done is putting the `Drawer` component into its own separate file.
export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<Session | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [activeSession, setActiveSession] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionDuration, setSessionDuration] = useState<number>(0);
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const [sessionRemainingSeconds, setSessionRemainingSeconds] = useState<number>(0);
  const [plannedExerciseCount, setPlannedExerciseCount] = useState<number>(0);
  const sessionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isRecoverySession, setIsRecoverySession] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [openCategory, setOpenCategory] = useState(false);
  const [activeProblem, setActiveProblem] = useState<null | string>(null);
  const problems = useLoaderData() as Problem[];
  const [activeCategory, setActiveCategory] = useState<string | null>(() => {return 'Fundamentals';});
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [searchedProblems, setSearchedProblems] = useState<Problem[]>([]);
  const [selectedTab, setSelectedTab] = useState("");
  const [contract, setContract] = useState<ContractData>(BLANK_CONTRACT);
  const [progress, setProgress] = useState<Submission[]>([]);

  const contractProgress: ContractProgress = contract.Coding.problemsToSolveByCategory;
  contractProgress["mutation"] = contract.Mutation.problemsToSolve;
  contractProgress["haystack"] = contract.Haystack.problemsToSolve;

  let newDifficulty = difficulty;
  if (newDifficulty === "all") newDifficulty = "";

  const filteredProblems = useMemo(() => {
    return problems.filter(problem => {
      return problem.meta.title.toLowerCase().includes(query.toLowerCase().trim()) &&
        problem.meta.difficulty.includes(newDifficulty);
    });
  }, [problems, query, newDifficulty])

  useEffect(() => {
    setSearchedProblems(filteredProblems);
  }, [filteredProblems])

  function handleSelectedCategory(category: string){
    setActiveCategory(category)
    setActiveProblem(null)
    setOpenCategory(false)
    if(category === "coding") setSelectedTab("") 
    else setSelectedTab("List")
  }

  function handleSelectedProblem(name: string){
    setActiveProblem(name)
    setOpen(false)
  }

  useEffect(() => {
    supabase.auth.onAuthStateChange((_event, session) => {
      if(_event === 'PASSWORD_RECOVERY'){
        setIsRecoverySession(true);
        return;
      }
      setIsRecoverySession(false);
      setSession(session);
      if (session?.user) {
        supabase
          .from('profiles')
          .select('is_admin')
          .eq('profile_id', session.user.id)
          .single()
          .then(({ data, error }) => {
            if (!error && data) {
              setIsAdmin(data.is_admin);
            }
          });
      } else {
        setIsAdmin(false);
      }
    });
    if(!isRecoverySession){
      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session);
        if (session?.user){
          supabase
            .from('profiles')
            .select('is_admin')
            .eq('profile_id', session.user.id)
            .single()
            .then(({ data, error }) => {
              if (!error && data) {
                setIsAdmin(data.is_admin);
              }
            });
        }
      });
    }
  }, [isRecoverySession]);

  useEffect(() => {
    (async () => {
      if (!session) return;

      const { data } = await supabase
        .from("contracts")
        .select("data")
        .eq("profile_id", session?.user.id)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (data?.[0]?.data) setContract(data[0].data);
      else setContract(BLANK_CONTRACT)
    })();
  }, [session]);

  const fetchProfile = useCallback(async () => {
    if (!session) return;
    const { user } = session;

    const { data } = await supabase
      .from('profiles')
      .select('username, pfp_id')
      .eq('profile_id', user.id)
      .single();

    if (data) {
      setUserData({
        name: data.username,
        pfp_id: data.pfp_id
      });
    }
  }, [session]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const fetchProgress = useCallback(async () => {
    if(!session) return;
    const { data: submissions, error } = await supabase
      .from('submissions')
      .select('problem_title, passed_tests, total_tests, question_type')
      .eq('profile_id', session.user.id);
    if(!error) setProgress(submissions || []);
  }, [session]);

  useEffect(() => {
    fetchProgress();
  }, [fetchProgress]);

  const startSession = (sessionIdFromState: string, durationMinutes: number, exerciseCount: number) => {
    setSessionId(sessionIdFromState);
    setSessionDuration(durationMinutes);
    setPlannedExerciseCount(exerciseCount);
    setSessionStartTime(new Date());
    setSessionRemainingSeconds(durationMinutes * 60);
    setActiveSession(true);
  };

  const endSession = () => {
    if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
    setActiveSession(false);
    setSessionId(null);
    setSessionStartTime(null);
    setSessionDuration(0);
    setSessionRemainingSeconds(0);
  };

  // Handle session start when coming back from PreSessionForm
  useEffect(() => {
    const sessionIdFromState = (location.state as any)?.sessionId;
    if (sessionIdFromState && session?.user) {
      const fetchSessionData = async () => {
        const { data, error } = await supabase
          .from('sessions')
          .select('planned_duration_minutes, exercise_goals')
          .eq('id', sessionIdFromState)
          .eq('profile_id', session.user.id)
          .single();

        if (!error && data) {
          startSession(sessionIdFromState, data.planned_duration_minutes, data.exercise_goals);
        }
      };
      fetchSessionData();
    }
  }, [location.state, session?.user]);

  // Session countdown timer
  useEffect(() => {
    if (!activeSession || !sessionStartTime) return;

    sessionTimerRef.current = setInterval(() => {
      const elapsed = Math.floor((new Date().getTime() - sessionStartTime.getTime()) / 1000);
      const remaining = Math.max(0, sessionDuration * 60 - elapsed);
      setSessionRemainingSeconds(remaining);

      if (remaining <= 0) {
        clearInterval(sessionTimerRef.current!);
        // Session ended - user should be prompted to post-session
        // Don't navigate automatically, let them finish current problem
      }
    }, 1000);

    return () => {
      if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
    };
  }, [activeSession, sessionStartTime, sessionDuration]);

  return (
    <Box sx={{ display:'flex', height: "100%", flex: 1}}>
      <Stack
       sx={{
          width: '6em',
          cursor: 'pointer',
          alignItems: 'center',
          position: 'relative',
          '&::after': {
            content: '""',
            position: 'absolute',
            top: '50%',
            width: '70px',
            height: '70px',
            backgroundImage: `url(${whitePaw})`,
            backgroundSize: 'contain',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            transform: 'rotate(-90deg)'
          },
          '&:hover::after': {
            backgroundImage: `url(${whitePawHover})`
          }
        }}
        className="desktop-bar"
        onClick={() => setOpen(true)}
      />
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        // Temporary fix for: https://github.com/coding-cat-official/coding-cat/pull/56
        sx={{
          "--ModalClose-inset": "1rem",
          "--Drawer-verticalSize": "clamp(500px, 60%, 100%)",
          "--Drawer-horizontalSize": "100vw",
          "--Drawer-titleMargin": "1rem 1rem calc(1rem / 2)",
        }}
      >
        <ModalClose />
          <Stack width="100%" direction="row" justifyContent="space-between" padding={'10px'} className="big-navbar" sx={{alignItems: "center"}}>
            <DialogTitle level='h1'  sx={{ fontFamily: '"Silkscreen", monospace', padding: "5px", fontSize: "30pt"}}>
              Coding Cat
            </DialogTitle>
            <Stack marginRight="5em" direction="row" gap={3} className="problemList-search-filter">
              <Select sx={{ width: "150px", fontWeight: "normal", fontFamily: "Silkscreen" }} placeholder="Difficulty" value={difficulty} onChange={(e, newValue) => setDifficulty(newValue || "")}>
                <Option sx={{fontFamily: "Silkscreen"}} value="all">All</Option>
                <Option sx={{fontFamily: "Silkscreen"}} value="easy">Easy</Option>
                <Option sx={{fontFamily: "Silkscreen"}} value="medium">Medium</Option>
                <Option sx={{fontFamily: "Silkscreen"}} value="hard">Hard</Option>
              </Select>
              <CustomSearch query={query} setQuery={setQuery} placeholder="Search for exercises..." />
            </Stack>
          </Stack>
        <DialogContent>
          <Box sx={{ display: 'flex', overflow: 'hidden', gap: "16px" }}>
              <Button className="mobile-categoryList" onClick={() => setOpenCategory(true)}>&gt;</Button>
              <Drawer open={openCategory} onClose={() => setOpenCategory(false)} sx={{ flex: 1, width: 300, overflowY: 'auto',}} className="mobile-categoryList">
                <CategoryList
                  searchedProblems={searchedProblems}
                  activeCategory={activeCategory}
                  onSelectCategory={handleSelectedCategory}
                  session={session}
                  contractProgress={contractProgress}
                />
              </Drawer>
              <Box sx={{ flex: 1, width: 300, overflowY: 'auto',}} className="categoryList">
                <CategoryList
                  searchedProblems={searchedProblems}
                  activeCategory={activeCategory}
                  onSelectCategory={handleSelectedCategory}
                  session={session}
                  contractProgress={contractProgress}
                />
              </Box>
              <Box sx={{ flex: 3}} className="parent-problemList">
                <ProblemList
                  selectedTab={selectedTab}
                  setSelectedTab={setSelectedTab}
                  searchedProblems={searchedProblems}
                  selectedCategory={activeCategory}
                  activeProblem={activeProblem}
                  onSelectProblem={handleSelectedProblem}
                  closeDrawer={() => setOpen(false)}
                  session={session}
                  contractProgress={contractProgress}
                  progress={progress}
                />
              </Box>
            </Box>
        </DialogContent>
      </Drawer>
      <Stack
        className= 'main'
        direction="column"
        sx={{
          width: '100%',
          minHeight: "100%",
          height: "100%",
          justifyContent: "start",
          alignItems: "center",
          overflowY: "scroll"
        }} >
          <Stack sx={{ width: '100%', display: 'flex', flexDirection: 'row'}} className="upper-nav">
            <Button sx={{ margin: '10px 10px 0 10px', cursor: 'pointer'}} onClick={() => setOpen(true)} className="mobile-bar">
              <ListIcon size={20} />
            </Button>
            <Box sx={{ margin: '10px 10px 0 10px', display: 'flex', gap: 1 }} className="account-btns">
              {session && !isRecoverySession ? (
                <>
                  <Button 
                    onClick={() => {
                      if (activeSession) {
                        endSession();
                        navigate('/post-session', { state: { sessionId } });
                      } else {
                        navigate('/session');
                      }
                    }}
                    sx={{ backgroundColor: activeSession ? '#ffb5a9' : '#d4ff99' }}
                    title={activeSession ? "Click to end session" : "Start a new session"}
                  >
                    {activeSession ? 'Ongoing Session' : 'Start Session'}
                  </Button>
                  <Link to="/profile">
                    <Button>
                      <Stack flexDirection="row" alignItems="center" gap={1}>
                        {
                          userData?.pfp_id != null ?
                            <ProfileAvatar 
                              fileName={ALL_PFPS[userData.pfp_id]}
                              height={25}
                              width={25}
                            />
                          : <></>
                        }
                        { userData?.name ?? "Profile" }
                      </Stack>
                    </Button>
                  </Link>
                  <Button onClick={() => supabase.auth.signOut()}>Sign Out</Button>
                  {isAdmin && (
                    <Link to="/admin">
                      <Button color="warning">Admin</Button>
                    </Link>
                  )}
                </>
              ) : (
                <>
                  <Link to="/signin">
                    <Button>Login</Button>
                  </Link>
                  <Link to="/register">
                    <Button>Register</Button>
                  </Link>
                </>
              )}
            </Box>
          </Stack>
        
        <Stack sx={{ width: '100%' }} direction="row" alignItems="center" justifyContent="center"  className="logo">
          <Link to="/">
            <Box component="img" src={logo} sx={{ maxHeight: "80px", marginTop: "5px", marginRight:"15px" }}/>
          </Link>
            <Typography  sx={{ fontFamily: '"Silkscreen", monospace', fontSize: "35pt"}} level="h1">
              Coding Cat!
            </Typography>
        </Stack>
        
        <Box width="100%" height="100%">
          <Outlet context={{ 
            setActiveProblem, 
            session, 
            isAdmin, 
            refetchProgress: fetchProgress,
            activeSession,
            sessionId,
            sessionRemainingSeconds,
            sessionDuration,
            plannedExerciseCount
          }} />
        </Box>
        
      </Stack>
    </Box>
)};

export async function problemListLoader(): Promise<Problem[]> {
  return await getProblemSet() as Problem[];
}
