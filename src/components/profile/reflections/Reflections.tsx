import { Dispatch, SetStateAction, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Problem, Reflection } from "../../../types";
import { capitalizeString } from "../../../utils/capitalizeString";
import { Box, Card, CardContent, Option, Select, Stack, Typography } from "@mui/joy";
import { getCategoryList } from "../../../utils/getCategoryList";
import CustomSearch from "../../ProblemSearch";

export default function Reflections({ reflections }: { reflections: Reflection[] }) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");

  let cat = category;
  if (cat === "all") cat = "";

  const filteredReflections = reflections.filter((r) => {
    const name = capitalizeString(r.problem_title).toLowerCase();
    return name.includes(query.toLowerCase()) && r.category.includes(cat);
  });

  if (!filteredReflections.length) {
    return (
      <>
        <ReflectionTitle query={query} setQuery={setQuery} category={cat} setCategory={setCategory} />
        <Typography>You have no reflections!</Typography>
      </>
    )
  }

  return (
    <>
      <ReflectionTitle query={query} setQuery={setQuery} category={cat} setCategory={setCategory} />
      <Stack gap={2} mb={2} sx={{ maxHeight: '100%', overflowY: 'auto', scrollbarWidth: "thin"}}>
        {filteredReflections.map((reflection, index) => {
          const isOpen = expandedIndex === index
          return (
            <Card
              key={`${reflection.problem_title}-${reflection.submitted_at}`}
              onClick={() => setExpandedIndex(isOpen ? null : index)}
              sx={{cursor: 'pointer', width: '90%'}}>
              <CardContent>
                <Stack spacing={1}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography level="h3">{capitalizeString(reflection.problem_title)}</Typography>
                    <Typography color="neutral" fontSize="sm">
                      {reflection.category}
                    </Typography>
                  </Stack>

                  <Typography fontSize="sm" color="neutral">
                    Written on{' '}
                    {new Date(reflection.submitted_at).toLocaleString()}
                  </Typography>

                  {typeof reflection.reflection === 'string' ? (
                    <Typography>{reflection.reflection}</Typography>
                  ) : (
                    <Stack spacing={1}>
                      <Typography>
                        <strong>Question:</strong> {reflection.reflection.question}
                      </Typography>
                      <Typography>
                        <strong>Reflection:</strong> {reflection.reflection.answer}
                      </Typography>
                    </Stack>
                  )}

                  {isOpen && reflection.code && (
                    <Box component="pre" sx={{mt: 1, p: 1, bgcolor: '#f5f5f5', borderRadius: 1, fontSize: '0.85rem', overflowX: 'auto', }}>
                      {
                        "code" in reflection.code ? reflection.code.code :
                        reflection.code.map((c, i) => (
                          `Input ${++i}: ${c.Input}\t\t Output: ${c.Expected}\n`
                        ))
                      }
                    </Box>
                  )}
                </Stack>
              </CardContent>
            </Card>
          )
        })}
      </Stack>
    </>
  )
}

interface SearchProps {
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  category: string;
  setCategory: Dispatch<SetStateAction<string>>;
}

function ReflectionTitle({ query, setQuery, category, setCategory }: SearchProps) {
  // The problem set the app actually loaded, provided by the root route. Read
  // from context rather than imported so REACT_APP_PROBLEM_SET is honoured.
  const { problems } = useOutletContext<{ problems: Problem[] }>();
  const categories = useMemo(() => getCategoryList(problems ?? []), [problems]);

  return (
    <Stack width="90%" direction="row" justifyContent="space-between" alignItems="center">
      <Typography level="h2">Reflections</Typography>
      <Stack direction="row" gap={2}>
        <Select sx={{ width: "150px", fontFamily: "Silkscreen" }} placeholder="Category" value={category} onChange={(e, newValue) => setCategory(newValue || "")}>
          <Option sx={{ fontFamily: "Silkscreen"}} value="all">All</Option>
          { categories.map((c) => <Option value={c} sx={{ fontFamily: "Silkscreen"}}>{c}</Option>) }
        </Select>
        <CustomSearch query={query} setQuery={setQuery} placeholder="Search for reflections..." />
      </Stack>
    </Stack>
  )
}
