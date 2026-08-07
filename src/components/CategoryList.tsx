import { List, Box, Typography } from '@mui/joy'
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Session } from '@supabase/supabase-js';
import { getCompletedProblems } from '../utils/getCompletedProblems';
import { ContractProgress, Problem, Progress } from '../types';
import CategoryLock from '../utils/CategoryLock';
import CategoryListItems from './CategoryListItem';

export interface CategoryListProps {
    /**
     * The full configured problem set. Distinct from `searchedProblems`: the
     * per-category totals must not shrink as the user types in the search box.
     */
    problems: Problem[];
    searchedProblems: Problem[];
    activeCategory: string | null;
    onSelectCategory: (cat: string) => void;
    session: Session | null;
    contractProgress: ContractProgress;
}

export default function CategoryList({
    problems,
    searchedProblems,
    activeCategory,
    onSelectCategory,
    session,
    contractProgress
  }: CategoryListProps) {
    const [error, setError] = useState("");
    const [progress, setProgress] = useState<Progress[]>([]);

    // List of categories that show up in search results.
    const categories = searchedProblems
    .map((c) => c.meta.category)
    .filter((c, index, array) => array.indexOf(c) === index)
    .sort((a,b) => a.localeCompare(b));

    const specialCategories = [];
    if (searchedProblems.some((c) => c.meta.question_type[0] === 'mutation')) {
        specialCategories.push("mutation");
    }
    if (searchedProblems.some((c) => c.meta.question_type[0] === 'haystack')) {
        specialCategories.push("haystack");
    }


    useEffect(() => {
        async function fetchProgress() {
            if (!session) return;
            const { user } = session;
            
            const {data: submissions, error } = await supabase
            .from('submissions')
            .select('problem_title, passed_tests, total_tests, question_type')
            .eq('profile_id', user.id);

            if(error) {
                setError(error.message);
            }

            const summary = getCompletedProblems(problems, submissions || []);

            setProgress(summary);
        }

        fetchProgress();
    }, [session, problems])

    const categoryLock = useMemo(() => new CategoryLock(progress), [progress]);

    /**
     * Maps the string of the category name to the corresponding Lock object.
     * 
     * **TODO: This function should probably be moved inside the CategoryLock class.**
     */
    function mapCategoryToLock(category: string) {
        switch(category) {
            case "Fundamentals": return categoryLock.fundamentals
            case "Logic": return categoryLock.logic
            case "String-1": return categoryLock.string_1
            case "String-2": return categoryLock.string_2
            case "String-3": return categoryLock.string_3
            case "List-1: Indexing": return categoryLock.list_1
            case "List-2: Iterating": return categoryLock.list_2
            case "List-3: Complex Loop": return categoryLock.list_3
            case "Mutation": return categoryLock.mutation
            case "Haystack": return categoryLock.haystack
            default: return categoryLock.fundamentals
        }
    }

    if (error) {
        return (
            <Typography>Error fetching categories: {error}</Typography>
        )
    }

    return (
        <List component="nav" sx={{ py: 2}}>
            <>
                <CategoryListItems
                    categories={categories}
                    type="category"
                    progress={progress}
                    mapCategoryToLock={mapCategoryToLock}
                    activeCategory={activeCategory}
                    onSelectCategory={onSelectCategory}
                    session={session}
                    contractProgress={contractProgress}
                />
                <Box>
                    <hr/>
                </Box>
                <CategoryListItems
                    categories={specialCategories}
                    type="question_type"
                    progress={progress}
                    mapCategoryToLock={mapCategoryToLock}
                    activeCategory={activeCategory}
                    onSelectCategory={onSelectCategory}
                    session={session}
                    contractProgress={contractProgress}
                />
            </>
        </List>
    )
}
