import { Dispatch, SetStateAction } from "react";
import { ContractData } from "../../../types";
import { Button, Input, Option, Select, Stack, Table, Typography } from "@mui/joy";
import { contractCategories } from "../../../utils/contractCategories";

interface ContractEditProps {
  setIsUpdating: Dispatch<SetStateAction<boolean>>;
  contract: ContractData;
  setContract: Dispatch<SetStateAction<ContractData>>;
  onSave: () => Promise<void>;
  featureMap: Record<string,boolean>;
}

export default function ContractEdit({ setIsUpdating, contract, setContract, onSave, featureMap }: ContractEditProps) {
  const allCategories = Object.keys(contract.Coding.problemsToSolveByCategory);
  const categoriesToEdit = contractCategories(allCategories, featureMap["CodingStage2"]);

  return (
    <>
      <Stack sx={{ overflowY: "scroll" }} gap={2}>
        <Typography level="h3">Coding</Typography>
        <Stack direction="row" alignItems="center" gap={2}>
          <Typography>What grade do you want to get?</Typography>
          <Select placeholder="Grade" value={contract.Coding.gradeWanted}
            onChange={(_, v) =>                          
              setContract(c => ({
                ...c,
                Coding: { ...c.Coding, gradeWanted: v as string },
              }))
            }>
            <Option value="proficient">Proficient</Option>
            <Option value="approaching_mastery">Approaching Mastery</Option>
            <Option value="mastery">Mastery</Option>
          </Select>
        </Stack>
        <Typography sx={{ whiteSpace: "pre-line" }}>How many problems of each category will you solve?</Typography>
        <Stack justifyContent="center" direction="row" columnGap={20} rowGap={2} flexWrap="wrap">
          <Table sx={{ display: "flex", justifyContent: "center" }}>
            <tr>
              {
                categoriesToEdit.map((c) => {
                  return (
                    <td style={{ display: "inline-block" }}>
                      <Stack direction="row" alignItems="center" gap={1}>
                        <Typography>{c}: </Typography>
                        <Input
                          variant="plain"
                          size="sm"
                          sx={{ width: "50px", typography: 'body1' }}
                          slotProps={{ input: { type: "number", min: 0 } }}
                          placeholder="0"
                          value={contract.Coding.problemsToSolveByCategory[c]}
                          onChange={(e) =>
                            setContract((cat) => ({
                              ...cat,
                              Coding: {
                                ...cat.Coding,
                                problemsToSolveByCategory: {
                                  ...cat.Coding.problemsToSolveByCategory,
                                  [c]: +e.target.value,
                                },
                              },
                            }))
                          }
                        />
                      </Stack>
                    </td>
                  )
                })
              }
            </tr>
          </Table>
        </Stack>
        <Typography>Give a qualitative description of what your code will look like in order to achieve your desired grade.</Typography>
        <Input value={contract.Coding.codeDescription} 
          onChange={(e) =>
            setContract((c) => ({
              ...c,
              Coding: { ...c.Coding, codeDescription: e.target.value },
            }))
          } placeholder="Enter your answer..." />
        <Typography>How many reflections will you do in order to reach your desired grade and how in depth will you go with them?</Typography>
        <Input value={contract.Coding.reflectionPlan} onChange={(e) =>
          setContract((c) => ({
            ...c,
            Coding: { ...c.Coding, reflectionPlan: e.target.value },
          }))
        } placeholder="Enter your answer..." />

        {featureMap["Haystack"] && (
          <>
            <Typography level="h3">Haystack</Typography>
            <Stack direction="row" alignItems="center" gap={2}>
              <Typography>What grade do you want to get?</Typography>
              <Select placeholder="Grade" value={contract.Haystack.gradeWanted} 
                onChange={(_, v) =>
                  setContract(c => ({
                    ...c,
                    Haystack: { ...c.Haystack, gradeWanted: v as string },
                  }))
                }>
                <Option value="proficient">Proficient</Option>
                <Option value="approaching_mastery">Approaching Mastery</Option>
                <Option value="mastery">Mastery</Option>
              </Select>
            </Stack>
            <Stack direction="row" alignItems="center" gap={2}>
              <Typography>How many haystack problems will you solve?</Typography>
              <Input slotProps={{input:{type:"number", min: 0}}} value={contract.Haystack.problemsToSolve} 
                onChange={(e) =>
                  setContract((c) => ({
                    ...c,
                    Haystack: { ...c.Haystack, problemsToSolve: +e.target.value },
                  }))
                } sx={{ width: "4em" }} placeholder="0" />
            </Stack>
            <Typography>Give a qualitative description of what your code will look like in order to achieve your desired grade.</Typography>
            <Input placeholder="Enter your answer..." value={contract.Haystack.codeDescription} 
              onChange={(e) =>
                setContract((c) => ({
                  ...c,
                  Haystack: { ...c.Haystack, codeDescription: e.target.value },
                }))
              }/>
            <Typography>How many reflections will you do in order to reach your desired grade and how in depth will you go with them?</Typography>
            <Input placeholder="Enter your answer..." value={contract.Haystack.reflectionPlan} 
              onChange={(e) =>
                setContract((c) => ({
                  ...c,
                  Haystack: { ...c.Haystack, reflectionPlan: e.target.value },
                }))
              }/>
            </>
        )}

        {featureMap["Mutation"] && (
          <>
            <Typography level="h3">Mutation Testing</Typography>
            <Stack direction="row" alignItems="center" gap={2}>
              <Typography>What grade do you want to get?</Typography>
              <Select placeholder="Grade" value={contract.Mutation.gradeWanted}
                onChange={(_, v) =>
                  setContract(c => ({
                    ...c,
                    Mutation: { ...c.Mutation, gradeWanted: v as string },
                  }))
                }>
                <Option value="proficient">Proficient</Option>
                <Option value="approaching_mastery">Approaching Mastery</Option>
                <Option value="mastery">Mastery</Option>
              </Select>
            </Stack>
            <Stack direction="row" alignItems="center" gap={2}>
              <Typography>How many mutation testing problems will you solve?</Typography>
              <Input sx={{ width: "4em" }} placeholder="0" slotProps={{input:{type:"number", min: 0}}} value={contract.Mutation.problemsToSolve} 
                onChange={(e) =>
                  setContract((c) => ({
                    ...c,
                    Mutation: { ...c.Mutation, problemsToSolve: +e.target.value },
                  }))
                }/>
            </Stack>
            <Typography>Give a qualitative description of what your code will look like in order to achieve your desired grade.</Typography>
            <Input placeholder="Enter your answer..." value={contract.Mutation.codeDescription} 
              onChange={(e) =>
                setContract((c) => ({
                  ...c,
                  Mutation: { ...c.Mutation, codeDescription: e.target.value },
                }))
              }/>
            <Typography>How many reflections will you do in order to reach your desired grade and how in depth will you go with them?</Typography>
            <Input placeholder="Enter your answer..." value={contract.Mutation.reflectionPlan} 
              onChange={(e) =>
                setContract((c) => ({
                  ...c,
                  Mutation: { ...c.Mutation, reflectionPlan: e.target.value },
                }))
              }/>
            </>
        )}
      </Stack>

      <Stack direction="row" justifyContent="flex-end" alignItems="center" gap={2}>
        <Typography level="body-xs">Last Modified: { new Date().toDateString() }</Typography>
        <Button sx={{ width: "15%" }} variant="outlined" onClick={() => setIsUpdating(false)}>Cancel</Button>
        <Button sx={{ width: "15%" }} onClick={async() => { await onSave(); setIsUpdating(false);}}>Save Changes</Button>
      </Stack>
    </>
  )
}
