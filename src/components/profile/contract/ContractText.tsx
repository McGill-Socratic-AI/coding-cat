import { Dispatch, SetStateAction } from "react";
import { ContractData } from "../../../types";
import { Box, Button, Stack, Typography } from "@mui/joy";
import { contractCategories } from "../../../utils/contractCategories";

interface ContractTextProps {
  setIsUpdating: Dispatch<SetStateAction<boolean>>;
  contract: ContractData;
  lastUpdated: Date | null;
  featureMap: Record<string, boolean>;
}

export default function ContractText({ setIsUpdating, contract, lastUpdated, featureMap }: ContractTextProps) {
  const allCategories = Object.keys(contract.Coding.problemsToSolveByCategory);

  // featureMap determines which stage of the contract to show. if you want to display only questions from coding stage 2
  // or mutation/haystack, add it in the corresponding featureMap in the JSX. make sure to do this for ContractEdit as well.
  const categoriesToShow = contractCategories(allCategories, featureMap["CodingStage2"]);


  return (
    <>
      <Stack sx={{ overflowY: "scroll"}} gap={2}>
        <Typography level="h3">Coding</Typography>
        <Typography>What grade do you want to get? <strong>{contract.Coding.gradeWanted}</strong></Typography>
        <Typography sx={{ whiteSpace: "pre-line" }}>How many problems of each category will you solve?</Typography>
        <Stack direction="row" flexWrap="wrap" columnGap={4} rowGap={2} justifyContent="center">
          {categoriesToShow.map((cat) => (
            <Typography key={cat}>
              {cat}: <strong>{contract.Coding.problemsToSolveByCategory[cat]}</strong>
            </Typography>
          ))}
          </Stack>
        <Typography>
          Give a qualitative description of what your code will look like in order to achieve your desired grade.<br />
          <Box component="div" sx={{p: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word', }}>
            <strong>{contract.Coding.codeDescription}</strong>
          </Box>
        </Typography>
        <Typography>
          How many reflections will you do in order to reach your desired grade and how in depth will you go with them?<br />
          <Box component="div" sx={{p: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word', }}>
            <strong>{contract.Coding.reflectionPlan}</strong>
          </Box>
        </Typography>

        {featureMap["Haystack"] && (
          <> 
            <Typography level="h3">Haystack</Typography>
            <Typography>What grade do you want to get? <strong>{contract.Haystack.gradeWanted}</strong></Typography>
            <Typography>How many haystack problems will you solve? <strong>{contract.Haystack.problemsToSolve}</strong></Typography>
            <Typography>
              Give a qualitative description of what your code will look like in order to achieve your desired grade.<br />
              <Box component="div" sx={{p: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word', }}>
                <strong>{contract.Haystack.codeDescription} </strong>
              </Box>
            </Typography>
            <Typography>
              How many reflections will you do in order to reach your desired grade and how in depth will you go with them?<br />
              <Box component="div" sx={{p: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word', }}>
                <strong>{contract.Haystack.reflectionPlan}</strong>
              </Box>
            </Typography>
          </>
        )}

        {featureMap["Mutation"] && (
          <>
            <Typography level="h3">Mutation Testing</Typography>
            <Typography>What grade do you want to get? <strong>{contract.Mutation.gradeWanted}</strong></Typography>
            <Typography>How many mutation testing problems will you solve? <strong>{contract.Mutation.problemsToSolve}</strong></Typography>
            <Typography>
              Give a qualitative description of what your code will look like in order to achieve your desired grade.<br />
              <Box component="div" sx={{p: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word', }}>
                <strong>{contract.Mutation.codeDescription}</strong>
              </Box>
            </Typography>
            <Typography>
              How many reflections will you do in order to reach your desired grade and how in depth will you go with them?<br />
              <Box component="div" sx={{p: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word', }}>
                <strong>{contract.Mutation.reflectionPlan}</strong>
              </Box>
            </Typography>
          </>
        )}
      </Stack>

      <Stack direction="row" justifyContent="flex-end" alignItems="center" gap={2}>
        <Typography level="body-xs">Last Modified:{' '} 
        {lastUpdated
          ? `${lastUpdated.toLocaleDateString()} ${lastUpdated.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}`
          : '—'}
        </Typography>
        <Button sx={{ width: "15%" }} onClick={() => setIsUpdating(true)}>Edit</Button>
      </Stack>
    </>
  )
}
